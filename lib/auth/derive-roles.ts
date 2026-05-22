/**
 * Role derivation fallback — resolves a session's roles from the `members`
 * table when the Auth0 JWT carries no `roles` claim.
 *
 * WHY THIS EXISTS:
 *   The intended mechanism is an Auth0 Post-Login Action that copies
 *   `event.authorization.roles` onto the JWT `roles` claim. Until that Action is
 *   deployed, real Auth0 sessions arrive with `roles: []`, so `buildAbility([])`
 *   denies everything — the app renders but every action 403s and most nav is
 *   hidden. `members.role` is described by the schema (lib/db/schema/members.ts)
 *   as "the canonical record of intended role", so it is a sound fallback.
 *
 * SECURITY:
 *   - Additive only: this is consulted exclusively when the JWT has NO roles. It
 *     never overrides or escalates a role that the JWT already asserts.
 *   - Default-deny preserved: any failure (tenant not provisioned, DB error, no
 *     matching member) yields an empty role list. This function never throws.
 *   - It can only grant what a tenant admin already provisioned into `members`.
 *
 * IDENTITY KEYING:
 *   The stable identity key is `auth0_user_id` (the Auth0 `sub`). A member
 *   provisioned before its first sign-in has `auth0_user_id` NULL; such a row is
 *   matched by email as a one-time bootstrap — `(tenant_id, email)` is unique,
 *   so the match is unambiguous. This mirrors the documented "link real Auth0
 *   sub → existing member row at first login" flow.
 *
 * Owner connection (BYPASSRLS) is used for the same chicken-and-egg reason as
 * resolve-tenant.ts: app.tenant_id is not yet bound when the session is built.
 */

import { getOwnerPool } from "@/lib/db/owner-pool";
import { resolveTenantIdByAuth0Org } from "./resolve-tenant";

const TTL_MS = 5 * 60 * 1000; // 5 minutes — matches the tenant resolver cache.

interface CacheEntry {
  roles: readonly string[];
  cachedAt: number;
}

const _cache = new Map<string, CacheEntry>();

/**
 * Clears the in-process role-derivation cache. Used in tests.
 * @internal
 */
export function clearRoleDerivationCache(): void {
  _cache.clear();
}

/**
 * Derives the role list for a session from the tenant's `members` table.
 *
 * @param orgId - Auth0 org_id claim from the JWT.
 * @param sub   - Auth0 user id (the `sub` claim) — the stable identity key.
 * @param email - Auth0 email claim — used only to bootstrap an unlinked member.
 * @returns A role array (e.g. `["tenant_admin"]`) or `[]` if no role can be derived.
 */
export async function deriveRolesFromMembership(
  orgId: string,
  sub: string,
  email: string,
): Promise<readonly string[]> {
  const cacheKey = `${orgId}|${sub}`;
  const cached = _cache.get(cacheKey);
  if (cached !== undefined && Date.now() - cached.cachedAt < TTL_MS) {
    return cached.roles;
  }

  let roles: readonly string[] = [];
  try {
    const tenantId = await resolveTenantIdByAuth0Org(orgId);
    const pool = getOwnerPool();
    const client = await pool.connect();
    try {
      // Prefer the row already linked to this Auth0 sub; fall back to an
      // unlinked member matched by email (first-login bootstrap).
      const result = await client.query<{ role: string }>(
        `SELECT role FROM members
          WHERE tenant_id = $1
            AND deleted_at IS NULL
            AND (auth0_user_id = $2 OR (auth0_user_id IS NULL AND lower(email) = lower($3)))
          ORDER BY (auth0_user_id = $2) DESC NULLS LAST
          LIMIT 1`,
        [tenantId, sub, email],
      );
      const row = result.rows[0];
      if (row?.role) {
        roles = [row.role];
      }
    } finally {
      client.release();
    }
  } catch {
    // Tenant not provisioned, DB unavailable, etc. — default-deny.
    roles = [];
  }

  _cache.set(cacheKey, { roles, cachedAt: Date.now() });
  return roles;
}
