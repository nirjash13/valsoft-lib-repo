-- Reverse of 0001_assert_tenant_guard.sql
-- Reverts policies to the 0000 form (current_setting('app.tenant_id')::uuid)
-- and drops the assert_tenant() function.

DROP POLICY IF EXISTS tenant_memberships_tenant_isolation ON tenant_memberships;
CREATE POLICY tenant_memberships_tenant_isolation ON tenant_memberships
  USING  (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS members_tenant_isolation ON members;
CREATE POLICY members_tenant_isolation ON members
  USING  (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS audit_log_tenant_isolation ON audit_log;
CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING  (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

DROP FUNCTION IF EXISTS assert_tenant();
