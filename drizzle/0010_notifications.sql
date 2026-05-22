-- =============================================================================
-- Migration: 0010_notifications
-- Description: Email notifications schema — outgoing_emails, email_batches,
--              plus new columns on members and tenants.
-- Spec:        07 — Notifications (Transactional + AI-Drafted Batch Emails)
--
-- New tables (both tenant-scoped):
--   • email_batches      — librarian-composed batch campaigns
--   • outgoing_emails    — per-recipient send audit trail
--
-- New columns (non-destructive, DEFAULT supplied — no safety:reviewed label required):
--   • members.email_status           (enum member_email_status, NOT NULL DEFAULT 'ok')
--   • members.lifecycle_emails_enabled (boolean, NOT NULL DEFAULT true)
--   • tenants.email_monthly_cap      (integer, NOT NULL DEFAULT 5000)
--
-- All tenant-scoped tables include:
--   • tenant_id NOT NULL
--   • composite tenant-first index
--   • RLS ENABLE + FORCE ROW LEVEL SECURITY
--   • policy using assert_tenant()
--   • GRANT SELECT, INSERT, UPDATE to stack_app
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE email_batch_status AS ENUM (
  'sent',
  'partial',
  'failed'
);

CREATE TYPE outgoing_email_type AS ENUM (
  'due_soon',
  'due_today',
  'overdue',
  'hold_ready',
  'welcome',
  'rejection',
  'batch_reminder'
);

CREATE TYPE email_delivery_status AS ENUM (
  'queued',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'failed',
  'skipped_opt_out',
  'skipped_subject_removed'
);

CREATE TYPE member_email_status AS ENUM (
  'ok',
  'bouncing',
  'complained'
);

-- ---------------------------------------------------------------------------
-- Column additions — non-destructive (DEFAULT supplied)
-- ---------------------------------------------------------------------------

-- members: email deliverability state (Spec 07 REQ-07-08)
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS email_status member_email_status NOT NULL DEFAULT 'ok';

-- members: lifecycle email opt-out (REQ-07-09 / US-08)
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS lifecycle_emails_enabled boolean NOT NULL DEFAULT true;

-- tenants: per-tenant monthly email volume cap (NFR-07-03)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS email_monthly_cap integer NOT NULL DEFAULT 5000;

-- ---------------------------------------------------------------------------
-- email_batches
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_batches (
  id               uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid                  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by       uuid                  NOT NULL REFERENCES members(id),
  audience_filter  text                  NOT NULL,
  subject          text                  NOT NULL,
  body_markdown    text                  NOT NULL,
  recipient_count  integer               NOT NULL,
  ai_drafted       boolean               NOT NULL DEFAULT false,
  status           email_batch_status    NOT NULL,
  created_at       timestamptz(3)        NOT NULL DEFAULT now()
);

-- Composite tenant-first index — covers per-tenant batch listing by recency
CREATE INDEX IF NOT EXISTS email_batches_tenant_at_idx
  ON email_batches (tenant_id, created_at);

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE email_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_batches FORCE ROW LEVEL SECURITY;

CREATE POLICY email_batches_tenant_isolation ON email_batches
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

GRANT SELECT, INSERT, UPDATE ON email_batches TO stack_app;

-- ---------------------------------------------------------------------------
-- outgoing_emails
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS outgoing_emails (
  id               uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid                    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- batch_id: ON DELETE SET NULL — batch row can be removed without losing the audit trail
  batch_id         uuid                    REFERENCES email_batches(id) ON DELETE SET NULL,
  member_id        uuid                    REFERENCES members(id) ON DELETE SET NULL,
  loan_id          uuid                    REFERENCES loans(id) ON DELETE SET NULL,
  to_email         text                    NOT NULL,
  email_type       outgoing_email_type     NOT NULL,
  delivery_status  email_delivery_status   NOT NULL,
  subject          text                    NOT NULL,
  resend_id        text,
  error            text,
  created_at       timestamptz(3)          NOT NULL DEFAULT now(),
  updated_at       timestamptz(3)          NOT NULL DEFAULT now(),
  sent_at          timestamptz(3)
);

-- Composite tenant-first index — covers per-tenant chronological delivery log
CREATE INDEX IF NOT EXISTS outgoing_emails_tenant_at_idx
  ON outgoing_emails (tenant_id, created_at);

-- Cron dedup index — check whether a loan+email_type was already dispatched
CREATE INDEX IF NOT EXISTS outgoing_emails_tenant_loan_type_idx
  ON outgoing_emails (tenant_id, loan_id, email_type);

-- Webhook lookup index — resolve a Resend message ID back to the outgoing_emails row
CREATE INDEX IF NOT EXISTS outgoing_emails_tenant_resend_idx
  ON outgoing_emails (tenant_id, resend_id);

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE outgoing_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE outgoing_emails FORCE ROW LEVEL SECURITY;

CREATE POLICY outgoing_emails_tenant_isolation ON outgoing_emails
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

GRANT SELECT, INSERT, UPDATE ON outgoing_emails TO stack_app;
