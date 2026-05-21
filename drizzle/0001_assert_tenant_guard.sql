-- =============================================================================
-- Migration: 0001_assert_tenant_guard
-- Description: Replace silent-empty RLS policies with an assert_tenant() guard.
-- Reason:      Postgres custom GUC parameters (app.*) do NOT raise from
--              current_setting() when unset — they return an empty string.
--              That makes the 0000 policies "silently return zero rows" instead
--              of "raise loudly" when a query bypasses withTenantTx, which
--              contradicts REQ-01-10 ("raises an exception").
-- Discovery:   scripts/verify-foundation.mjs check #4 failed with
--              "expected error but query succeeded".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- assert_tenant()
-- ---------------------------------------------------------------------------
-- Returns the current app.tenant_id as uuid, or RAISES if the parameter is
-- unset / empty. Marked STABLE so the planner caches the call per row scan
-- within a single statement.

CREATE OR REPLACE FUNCTION assert_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v text;
BEGIN
  v := current_setting('app.tenant_id', true);
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'app.tenant_id is not set — query bypassed withTenantTx'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v::uuid;
END;
$$;

-- ---------------------------------------------------------------------------
-- Replace RLS policies to use assert_tenant() instead of current_setting()::uuid.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_memberships_tenant_isolation ON tenant_memberships;
CREATE POLICY tenant_memberships_tenant_isolation ON tenant_memberships
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

DROP POLICY IF EXISTS members_tenant_isolation ON members;
CREATE POLICY members_tenant_isolation ON members
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

DROP POLICY IF EXISTS audit_log_tenant_isolation ON audit_log;
CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());
