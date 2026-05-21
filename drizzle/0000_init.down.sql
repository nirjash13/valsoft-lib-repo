-- =============================================================================
-- Down migration: 0000_init
-- Reverses drizzle/0000_init.sql — drops all objects in dependency order.
-- Idempotent: safe to run more than once (IF EXISTS guards).
-- =============================================================================

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
DROP FUNCTION IF EXISTS audit_log_reject_mutation();

DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS tenant_memberships CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

-- Extensions are intentionally NOT dropped — other migrations or applications
-- may depend on pgcrypto. Drop manually if a clean slate is required.
