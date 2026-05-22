-- =============================================================================
-- Migration: 0011_notifications_dedup — ROLLBACK
-- =============================================================================

DROP INDEX IF EXISTS outgoing_emails_reminder_dedup_idx;

ALTER TABLE email_batches
  DROP COLUMN IF EXISTS updated_at;
