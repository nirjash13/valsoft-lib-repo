/**
 * Tenant resolver — resolves Auth0 org_id (text) to the Postgres tenants.id (UUID).
 *
 * WHY owner connection (DATABASE_URL_UNPOOLED, BYPASSRLS):
 *   We cannot use the stack_app connection here because:
 *   (a) app.tenant_id is what we are trying to resolve — it is NOT yet bound.
 *   (b) The tenants_membership_isolation RLS policy subqueries tenant_memberships,
 *       which itself has a USING (tenant_id = assert_tenant()) policy. If app.tenant_id
 *       is unset, assert_tenant() raises — making it impossible to look up the tenant
 *       using the app connection before the tenant_id is known. This is the
 *       chicken-and-egg coupling documented in drizzle/0003_tenants_rls.sql.
 *   The owner connection (BYPASSRLS) sidesteps both constraints cleanly.
 *
 * WHY in-process cache:
 *   doc-04 §Token → tenant resolution prescribes "look up tenant_id once on session
 *   start and cache for the session lifetime." We implement a 5-minute TTL in-process
 *   Map<string, { id, cachedAt }> — acceptable for serverless cold-start patterns.
 *   No external KV dependency. The cache is per-process; cold starts do one DB round-trip.
 *
 * SECURITY: This module uses the owner connection. Any code path leading here must
 * have already verified the caller holds a valid Auth0 session with a non-empty org_id.
 * The resolver only reads from tenants; it does not write.
 */

import { getOwnerPool } from "@/lib/db/owner-pool";
import { TenantNotProvisionedError } from "./errors";
import type { TenantId } from "./types";

// ---------------------------------------------------------------------------
// In-process cache
// ---------------------------------------------------------------------------

const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  id: TenantId;
  cachedAt: number;
}

const _cache = new Map<string, CacheEntry>();

/**
 * Clears the in-process resolver cache.
 * Used in tests to ensure each test starts with a clean state.
 * @internal
 */
export function clearTenantResolverCache(): void {
  _cache.clear();
}

// ---------------------------------------------------------------------------
// resolveTenantIdByAuth0Org
// ---------------------------------------------------------------------------

/**
 * Resolves an Auth0 org_id string to the Postgres tenants.id UUID.
 *
 * Results are cached for 5 minutes per org_id. The first call per cold start
 * (or after TTL expiry) performs a SELECT against the tenants table using the
 * owner connection.
 *
 * @param orgId - The Auth0 org_id claim from the JWT (e.g. "org_abc123def").
 * @returns The corresponding `tenants.id` UUID, branded as TenantId.
 * @throws {TenantNotProvisionedError} If no tenants row matches the org_id.
 * @throws {Error} If DATABASE_URL_UNPOOLED is not set (config error).
 */
export async function resolveTenantIdByAuth0Org(orgId: string): Promise<TenantId> {
  if (!orgId) {
    throw new Error("resolveTenantIdByAuth0Org: orgId must be a non-empty string");
  }

  // Cache hit
  const cached = _cache.get(orgId);
  if (cached !== undefined && Date.now() - cached.cachedAt < TTL_MS) {
    return cached.id;
  }

  // Cache miss — query via owner connection (BYPASSRLS, no chicken-and-egg)
  const pool = getOwnerPool();
  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM tenants WHERE auth0_org_id = $1 LIMIT 1",
      [orgId],
    );

    if (result.rows.length === 0) {
      throw new TenantNotProvisionedError(orgId);
    }

    const tenantId = result.rows[0]?.id as TenantId;
    _cache.set(orgId, { id: tenantId, cachedAt: Date.now() });
    return tenantId;
  } finally {
    client.release();
  }
}
