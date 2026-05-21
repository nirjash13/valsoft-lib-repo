-- =============================================================================
-- Migration: 0002_app_role
-- Description: Create the non-BYPASSRLS application role.
--
-- Why this exists:
--   Neon's default role `neondb_owner` ships with `rolbypassrls = true`,
--   which makes it ignore RLS policies even when FORCE ROW LEVEL SECURITY
--   is enabled — verified empirically against the Neon dev branch on
--   2026-05-21 via scripts/verify-foundation.mjs.
--   doc-04 explicitly requires: "The app's DB role is NOT the table owner,
--   so RLS is actually enforced [VERIFIED — Postgres docs gotcha]".
--
-- After this migration applies:
--   - The application connects as `stack_app` (DATABASE_URL).
--   - Migrations + drizzle-kit + admin scripts continue to connect as
--     `neondb_owner` (DATABASE_URL_UNPOOLED) because they need DDL rights.
--
-- Password rotation:
--   The literal 'stack_app_dev_password' below is a development placeholder.
--   Before any non-local deployment, rotate via:
--     ALTER ROLE stack_app PASSWORD '<new-strong-secret>';
--   and update DATABASE_URL accordingly.
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'stack_app') THEN
    CREATE ROLE stack_app WITH
      LOGIN
      PASSWORD 'stack_app_dev_password'
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION;
  END IF;
END $$;

-- Sanity check: refuse to commit if stack_app accidentally inherited BYPASSRLS.
DO $$
DECLARE bypasses boolean;
BEGIN
  SELECT rolbypassrls INTO bypasses FROM pg_roles WHERE rolname = 'stack_app';
  IF bypasses THEN
    RAISE EXCEPTION 'stack_app role has BYPASSRLS — must be NOBYPASSRLS for RLS to apply';
  END IF;
END $$;

-- Data-plane privileges. Existing tables get explicit grants; future tables
-- inherit via ALTER DEFAULT PRIVILEGES.
GRANT USAGE ON SCHEMA public TO stack_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO stack_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stack_app;

-- Sequences (bigserial in audit_log) — need USAGE + SELECT for nextval.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO stack_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO stack_app;

-- Functions (assert_tenant, audit_log_reject_mutation) — need EXECUTE.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO stack_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO stack_app;

-- Note: audit_log's BEFORE-mutation triggers are EXECUTED as the table owner
-- (default for plpgsql functions), so stack_app's INSERT goes through the
-- trigger correctly without needing trigger-specific grants. The trigger
-- raises on UPDATE/DELETE attempts by stack_app — that's the desired behaviour.
