-- =============================================================================
-- Migration: 0006_circulation
-- Description: Circulation engine — members enhancements, loans, holds tables.
--              Adds status enum + updated_at to members; creates loans and holds
--              with RLS FORCE, composite tenant-first indexes, and FIFO hold
--              uniqueness constraint.
-- Spec:        03 — Circulation (Borrow, Return, Holds & Renewals)
--
-- SAFETY LABEL REQUIRED: This migration contains a NOT NULL backfill:
--   ALTER TABLE members ADD COLUMN IF NOT EXISTS status member_status NOT NULL DEFAULT 'active'
-- Adding a NOT NULL column with a DEFAULT on an existing populated table requires
-- the `safety:reviewed` PR label per .claude/rules/migrations.md §Per-PR safety.
-- Postgres 11+ executes this without a full table rewrite (the default value is
-- stored in the catalog, not back-filled immediately), but the project policy
-- requires the label regardless of Postgres version semantics.
-- Merge is blocked by CI until the `safety:reviewed` label is applied.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- members — add status enum + updated_at (ALTER existing table)
-- ---------------------------------------------------------------------------

-- Create enum type first (idempotent guard via DO block)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_status') THEN
    CREATE TYPE member_status AS ENUM ('pending', 'active', 'suspended');
  END IF;
END
$$;

-- Add status column (default 'active' so existing rows get a sensible default)
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS status member_status NOT NULL DEFAULT 'active';

-- Add updated_at column (back-fill with created_at for existing rows)
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS updated_at timestamptz(3) NOT NULL DEFAULT now();

-- Update existing rows so updated_at = created_at (avoids future false-positive drift)
UPDATE members SET updated_at = created_at WHERE updated_at = now() AND created_at < now();

-- Lower-case email uniqueness index (functional, per-tenant — case-insensitive dedup)
-- The existing UNIQUE constraint on (tenant_id, email) is case-sensitive; this index
-- adds case-insensitive enforcement used by Spec 04 self-signup lookup.
CREATE UNIQUE INDEX IF NOT EXISTS members_tenant_email_lower_idx
  ON members (tenant_id, lower(email));

-- Composite tenant-first index for "My holds" / "My loans" traversal
CREATE INDEX IF NOT EXISTS members_tenant_status_idx
  ON members (tenant_id, status);

-- ---------------------------------------------------------------------------
-- loans
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS loans (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  book_id         uuid          NOT NULL REFERENCES books(id)   ON DELETE RESTRICT,
  member_id       uuid          NOT NULL REFERENCES members(id) ON DELETE RESTRICT,

  -- Actor who performed the borrow (Auth0 sub — text, not FK to members)
  librarian_id    text          NOT NULL,

  -- Circulation timestamps
  checked_out_at  timestamptz(3) NOT NULL DEFAULT now(),
  due_at          timestamptz(3) NOT NULL,
  returned_at     timestamptz(3),

  -- Renewal tracking
  renewed_count   integer       NOT NULL DEFAULT 0,

  -- Standard audit timestamps
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  updated_at      timestamptz(3) NOT NULL DEFAULT now(),

  -- Soft-delete (normally NULL; reserved for Spec 08 purge worker)
  deleted_at      timestamptz
);

-- Composite tenant-first index (required by migrations.md — every tenant table)
CREATE INDEX IF NOT EXISTS loans_tenant_id_idx
  ON loans (tenant_id, id);

-- Partial index: active loans per book — used by hasActiveLoan + double-borrow guard
CREATE INDEX IF NOT EXISTS loans_tenant_book_active_idx
  ON loans (tenant_id, book_id)
  WHERE returned_at IS NULL;

-- Index for "My loans" list (member view)
CREATE INDEX IF NOT EXISTS loans_tenant_member_idx
  ON loans (tenant_id, member_id, returned_at);

-- Index for overdue scan (librarian / notification worker)
CREATE INDEX IF NOT EXISTS loans_tenant_due_active_idx
  ON loans (tenant_id, due_at)
  WHERE returned_at IS NULL;

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans FORCE ROW LEVEL SECURITY;

CREATE POLICY loans_tenant_isolation ON loans
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

-- ---------------------------------------------------------------------------
-- holds
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hold_status') THEN
    CREATE TYPE hold_status AS ENUM ('queued', 'ready', 'expired', 'cancelled');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS holds (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  book_id         uuid          NOT NULL REFERENCES books(id)   ON DELETE RESTRICT,
  member_id       uuid          NOT NULL REFERENCES members(id) ON DELETE RESTRICT,

  -- FIFO queue anchor
  queued_at       timestamptz(3) NOT NULL DEFAULT now(),
  status          hold_status   NOT NULL DEFAULT 'queued',

  -- Populated when status transitions to 'ready'
  ready_until     timestamptz(3),

  -- Standard audit timestamps
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  updated_at      timestamptz(3) NOT NULL DEFAULT now()
);

-- Composite tenant-first index (required by migrations.md)
CREATE INDEX IF NOT EXISTS holds_tenant_id_idx
  ON holds (tenant_id, id);

-- FIFO queue scan: order queued holds per book
CREATE INDEX IF NOT EXISTS holds_tenant_book_queue_idx
  ON holds (tenant_id, book_id, queued_at);

-- Worker scan: expire-stale worker selects by status
CREATE INDEX IF NOT EXISTS holds_tenant_status_idx
  ON holds (tenant_id, status);

-- "My holds" list
CREATE INDEX IF NOT EXISTS holds_tenant_member_idx
  ON holds (tenant_id, member_id);

-- PARTIAL UNIQUE INDEX: enforce no-second-active-hold per (tenant, book, member)
-- REQ-03-04: "refuse to place a second hold for the same member on the same book"
-- Only active holds (queued or ready) are subject to the constraint.
-- Expired / cancelled holds are allowed to coexist (historical record).
CREATE UNIQUE INDEX IF NOT EXISTS holds_active_unique_idx
  ON holds (tenant_id, book_id, member_id)
  WHERE status IN ('queued', 'ready');

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE holds FORCE ROW LEVEL SECURITY;

CREATE POLICY holds_tenant_isolation ON holds
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

-- ---------------------------------------------------------------------------
-- stack_app grants for new tables
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON loans TO stack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON holds TO stack_app;

-- members was already granted in 0000_init; no grant needed for ALTER-only changes.
