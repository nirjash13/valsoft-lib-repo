-- =============================================================================
-- Migration: 0011_notifications_dedup
-- Description: Reminder dedup + email_batches updated_at
-- Spec:        07 — Notifications critic fixes (H1/H2, M1, L1)
--
-- Changes:
--   1. Partial unique index on outgoing_emails (tenant_id, loan_id, email_type)
--      WHERE loan_id IS NOT NULL — makes reminder dedup authoritative at the DB
--      level and safe against concurrent cron runs (M1 fix).
--   2. Add updated_at column to email_batches — the status is mutated after
--      creation and operators need to know when a batch finalised (L1 fix).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Partial unique index on outgoing_emails
-- ---------------------------------------------------------------------------
-- Covers due_soon / due_today / overdue rows only (loan_id IS NOT NULL).
-- batch_reminder and transactional rows (loan_id IS NULL) are excluded.
-- The application catches unique-violation on INSERT and treats it as
-- "already recorded by a concurrent run — skip silently".

CREATE UNIQUE INDEX IF NOT EXISTS outgoing_emails_reminder_dedup_idx
  ON outgoing_emails (tenant_id, loan_id, email_type)
  WHERE loan_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. updated_at column on email_batches
-- ---------------------------------------------------------------------------
-- Non-destructive: DEFAULT supplied, no safety:reviewed label required.

ALTER TABLE email_batches
  ADD COLUMN IF NOT EXISTS updated_at timestamptz(3) NOT NULL DEFAULT now();
