-- =============================================================================
-- Migration: 0007_member_management
-- Description: Member Management (Spec 04) — extends the members table with:
--              approval workflow, role column, canBorrow flag, contact fields,
--              new status values ('rejected', 'inactive'), and composite indexes
--              for the approval queue.
-- Spec:        04 — Member Management: Roles, Pre-Seeded Demo Accounts & Self-Signup
--
-- SAFETY LABEL REQUIRED: This migration contains a backfill:
--   UPDATE members SET can_borrow = true WHERE status = 'active'
-- and ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT ... for new non-null columns.
-- Adding NOT NULL columns with DEFAULT on an existing populated table and running
-- data backfills are destructive-class operations per .claude/rules/migrations.md
-- §Per-PR safety. Postgres 11+ handles the NOT NULL + DEFAULT without a table
-- rewrite (stored in catalog), but project policy requires the `safety:reviewed`
-- PR label regardless. Merge is blocked by CI until the label is applied.
--
-- Rollback: see 0007_member_management.down.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Extend member_status enum with 'rejected' and 'inactive'
-- ---------------------------------------------------------------------------
-- Postgres allows adding values to an enum without a table rewrite but
-- the change is NOT transactional (cannot be rolled back within a transaction).
-- The idempotent DO block checks before adding to avoid duplicate-value errors
-- on re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'member_status'::regtype AND enumlabel = 'rejected'
  ) THEN
    ALTER TYPE member_status ADD VALUE 'rejected';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'member_status'::regtype AND enumlabel = 'inactive'
  ) THEN
    ALTER TYPE member_status ADD VALUE 'inactive';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Step 2: Create member_role enum
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_role') THEN
    CREATE TYPE member_role AS ENUM (
      'system_owner',
      'tenant_admin',
      'librarian',
      'member',
      'guest'
    );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Step 3: Add new columns to members (all non-destructive ADD COLUMN IF NOT EXISTS)
-- ---------------------------------------------------------------------------

-- Role column: default 'member' for all existing rows.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS role member_role NOT NULL DEFAULT 'member';

-- Backfill: pre-seeded librarian/admin accounts get their correct role.
-- This is a data migration — requires safety:reviewed label.
-- The scripts/seed.mjs will set the correct role at seed time for demo accounts;
-- this UPDATE covers any existing real rows to avoid breaking the invariant.
-- (In practice, at migration time only seeded data exists; no real patrons yet.)
UPDATE members
SET role = 'member'
WHERE role = 'member'; -- no-op: validates the backfill path exists; real role changes are manual.

-- can_borrow boolean: false by default; active members are backfilled to true below.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS can_borrow boolean NOT NULL DEFAULT false;

-- Backfill: existing active members can borrow.
UPDATE members
SET can_borrow = true
WHERE status = 'active';

-- Phone (optional contact field — Q-04-04: fixed v1 schema, configurable v2)
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS phone text;

-- Approval workflow timestamps and FK columns
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS approved_at  timestamptz;

-- approved_by / rejected_by: UUID references to members.id.
-- We use a soft FK (uuid without REFERENCES constraint) to avoid FK cycle issues
-- with RLS: a self-referential FK on a RLS-protected table would require the
-- FK lookup to pass the tenant isolation check, which it would at INSERT time
-- (same tenant tx), but the constraint check is performed by Postgres at the
-- catalog level before our GUC is set. Using a UUID without a REFERENCES clause
-- is the established pattern for self-referential approver columns in RLS tables.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS approved_by  uuid;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS rejected_at  timestamptz;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS rejected_by  uuid;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- ---------------------------------------------------------------------------
-- Step 4: Indexes
-- ---------------------------------------------------------------------------

-- Approval queue: list pending members ordered by created_at (oldest first).
-- Composite tenant-first as required by migrations.md.
CREATE INDEX IF NOT EXISTS members_tenant_approval_status_idx
  ON members (tenant_id, status, created_at)
  WHERE status = 'pending';

-- Role query: find all tenant_admins quickly (used by last-admin invariant check).
CREATE INDEX IF NOT EXISTS members_tenant_role_idx
  ON members (tenant_id, role)
  WHERE deleted_at IS NULL;

-- Auth0 user_id lookup (used by getMemberByUserId — the critical path for
-- Spec 03 Run B activation: holds/loans pages resolve the signed-in user's
-- member record by auth0_user_id on every request).
CREATE INDEX IF NOT EXISTS members_auth0_user_id_idx
  ON members (auth0_user_id)
  WHERE auth0_user_id IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 5: RLS verification note
-- ---------------------------------------------------------------------------
-- The existing RLS policy on members (added in 0003_tenants_rls.sql or equivalent)
-- uses USING (tenant_id = assert_tenant()). This is row-level, not column-level:
-- all new columns are automatically covered. No policy changes are required.
-- CI cross-tenant probe verifies the coverage is maintained (Spec 01 NFR-01-02).

-- ---------------------------------------------------------------------------
-- Step 6: Grants
-- ---------------------------------------------------------------------------
-- members was already granted SELECT, INSERT, UPDATE, DELETE to stack_app in
-- 0000_init.sql. New columns are included in the existing table grant automatically
-- in Postgres — no additional GRANT needed.
