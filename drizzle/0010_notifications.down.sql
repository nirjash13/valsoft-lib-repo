-- =============================================================================
-- Down migration: 0010_notifications
-- Reverses the schema changes introduced in 0010_notifications.sql.
-- Order: drop tables in FK-safe order (dependents first), then columns, then types.
-- =============================================================================

-- outgoing_emails references email_batches — drop first
DROP TABLE IF EXISTS outgoing_emails;
DROP TABLE IF EXISTS email_batches;

-- Remove columns added to existing tables (reverse order of addition)
ALTER TABLE tenants  DROP COLUMN IF EXISTS email_monthly_cap;
ALTER TABLE members  DROP COLUMN IF EXISTS lifecycle_emails_enabled;
ALTER TABLE members  DROP COLUMN IF EXISTS email_status;

-- Drop enums
DROP TYPE IF EXISTS member_email_status;
DROP TYPE IF EXISTS email_delivery_status;
DROP TYPE IF EXISTS outgoing_email_type;
DROP TYPE IF EXISTS email_batch_status;
