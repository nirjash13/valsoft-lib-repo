-- =============================================================================
-- Down migration: 0003_tenants_rls
-- Removes RLS + policies from the tenants table.
-- =============================================================================

DROP POLICY IF EXISTS tenants_system_owner_access ON tenants;
DROP POLICY IF EXISTS tenants_membership_isolation ON tenants;

ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
