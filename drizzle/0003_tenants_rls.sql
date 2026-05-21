-- =============================================================================
-- Migration: 0003_tenants_rls
-- Description: Add RLS + operator-mode policy on the tenants table.
--
-- Background (Run A deferred item):
--   The tenants table was intentionally left without RLS in Run A because no
--   app code path wrote to it. Run B adds the tenant-provisioning Server Action
--   (app/(admin)/tenants/actions.ts) and the CASL ability layer, so we can now
--   gate tenants reads with a membership-based policy.
--
-- Policy design:
--   1. tenants_membership_isolation (PERMISSIVE) — a user can see a tenant row
--      if they have a row in tenant_memberships for that tenant AND app.user_id is set.
--      This mirrors the pattern on tenant_memberships and members.
--
--   2. tenants_system_owner_access (PERMISSIVE) — allows reads/writes when
--      app.system_owner is set to 'true' (is_local). The withSystemOwnerTx
--      helper sets this flag before any INSERT or SELECT.
--      This is the Spec 01 §7 operator-mode escape hatch.
--
-- verify-foundation.mjs check #1 currently asserts tenants has NO RLS.
-- After this migration applies, that check will fail. The verifier is updated
-- in this run (see scripts/verify-foundation.mjs) to expect RLS on tenants.
-- =============================================================================

-- Enable RLS (rows are hidden from stack_app unless a policy allows them)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- FORCE — applies even when connected as neondb_owner (table owner).
-- This is belt-and-suspenders; neondb_owner already has BYPASSRLS, so FORCE
-- doesn't actually restrict the owner — but it documents intent.
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

-- Policy 1: membership-based isolation
-- A request may read/write a tenants row only if:
--   - app.user_id is set (i.e. the request went through withTenantTx or similar)
--   - there is a tenant_memberships row linking that user to this tenant
--
-- COUPLING WARNING: The subquery below reads from tenant_memberships, which itself
-- has RLS USING (tenant_id = assert_tenant()). That means the subquery evaluation
-- is silently narrowed by app.tenant_id — for a user in multiple tenants, only
-- the memberships for the currently bound tenant are visible.
--
-- Critical failure mode: if app.tenant_id is NOT yet bound when this policy runs,
-- assert_tenant() raises "insufficient_privilege" — making it impossible to use the
-- app (stack_app) connection to discover which tenant a user belongs to before
-- binding app.tenant_id. This is the chicken-and-egg coupling.
--
-- Callers that need to resolve a tenant before app.tenant_id is bound MUST use:
--   - resolveTenantIdByAuth0Org() in lib/auth/resolve-tenant.ts (owner connection)
--   - withSystemOwnerTx() in lib/db/with-system-owner-tx.ts (owner connection)
-- Never attempt to resolve via SELECT from tenants on the stack_app connection
-- without first binding app.tenant_id.
CREATE POLICY tenants_membership_isolation ON tenants
  AS PERMISSIVE
  FOR ALL
  TO stack_app
  USING (
    id IN (
      SELECT tenant_id
        FROM tenant_memberships
       WHERE user_id = current_setting('app.user_id', true)
         AND current_setting('app.user_id', true) <> ''
    )
  )
  WITH CHECK (
    id IN (
      SELECT tenant_id
        FROM tenant_memberships
       WHERE user_id = current_setting('app.user_id', true)
         AND current_setting('app.user_id', true) <> ''
    )
  );

-- Policy 2: operator-mode (system_owner)
-- Allows any operation when withSystemOwnerTx sets app.system_owner = 'true'.
-- Note: withSystemOwnerTx uses the owner connection (BYPASSRLS), so this policy
-- is a belt-and-suspenders guard for the stack_app role if it ever calls
-- provisioning paths through the pooler.
CREATE POLICY tenants_system_owner_access ON tenants
  AS PERMISSIVE
  FOR ALL
  TO stack_app
  USING (
    current_setting('app.system_owner', true) = 'true'
  )
  WITH CHECK (
    current_setting('app.system_owner', true) = 'true'
  );
