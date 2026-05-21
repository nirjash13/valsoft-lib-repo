-- =============================================================================
-- Rollback: 0006_circulation
-- =============================================================================

DROP TABLE IF EXISTS holds;
DROP TABLE IF EXISTS loans;
DROP TYPE IF EXISTS hold_status;

-- Reverse members alterations
ALTER TABLE members DROP COLUMN IF EXISTS status;
ALTER TABLE members DROP COLUMN IF EXISTS updated_at;
DROP INDEX IF EXISTS members_tenant_email_lower_idx;
DROP INDEX IF EXISTS members_tenant_status_idx;
DROP TYPE IF EXISTS member_status;
