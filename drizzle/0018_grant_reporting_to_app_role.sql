-- =============================================================================
-- Migration: 0018_grant_reporting_to_app_role
-- Description: Grant the application role (stack_app) read access to the
--              `reporting` schema.
--
-- Why this exists:
--   Migration 0012 created the `reporting` schema and its views (the public
--   catalog's reporting.public_books plus every operator dashboard view) but
--   never granted the non-owner application role any privilege on that schema.
--   Migration 0002 only granted stack_app on schema `public`. As a result every
--   runtime query against a reporting view failed with:
--     ERROR 42501  permission denied for schema reporting
--   which took down the public catalog and the entire reporting feature in the
--   deployed app.
--
--   The reporting views are read-only and each enforces tenant isolation
--   internally via the assert_tenant() predicate, so SELECT access for the
--   application role is safe — it cannot read across tenants.
--
-- Idempotent: GRANT / ALTER DEFAULT PRIVILEGES are safe to re-run.
-- =============================================================================

GRANT USAGE ON SCHEMA reporting TO stack_app;

-- Views are covered by ALL TABLES for GRANT purposes.
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO stack_app;

-- reporting.matches_period() is used by the NL-reporting dimensional views.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA reporting TO stack_app;

-- Future reporting views/functions created by the owner inherit these grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  GRANT SELECT ON TABLES TO stack_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  GRANT EXECUTE ON FUNCTIONS TO stack_app;
