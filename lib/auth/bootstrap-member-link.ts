/**
 * First-login member linkage — writes `members.auth0_user_id` on first sign-in.
 *
 * WHY THIS EXISTS:
 *   Members are seeded (or invited via Auth0) with `auth0_user_id` NULL. The
 *   schema (see derive-roles.ts) treats `(tenant_id, email)` as a one-time
 *   bootstrap key: on a member's first successful sign-in we look up their row
 *   by email and stamp the Auth0 `sub` so that `getMemberByUserId(sub)` — the
 *   strict lookup used by `/loans`, `/holds`, and `/members/me` — succeeds from
 *   then on. Without this stamp those pages render the "account not yet linked"
 *   placeholder forever.
 *
 *   `derive-roles.ts` reads the row by email-fallback but never writes the
 *   linkage. This module performs the missing write. It is invoked from
 *   `getSession()` on every request; the in-process cache caps it at one
 *   indexed UPDATE per session per 5 minutes.
 *
 * SECURITY / SAFETY:
 *   - WHERE clause is scoped: `tenant_id` (resolved from JWT `org_id`) +
 *     `lower(email)` + `auth0_user_id IS NULL` + `deleted_at IS NULL`.
 *     Only an UNLINKED row in the caller's own tenant can be stamped.
 *   - The `(tenant_id, email)` unique index guarantees at most one matching
 *     row, so there is no ambiguity.
 *   - Never overwrites a non-NULL `auth0_user_id` — the WHERE clause excludes
 *     already-linked rows. A pre-existing link to a different sub (corner
 *     case: same email re-provisioned with a new Auth0 account) is left alone;
 *     such drift surfaces as a "not yet linked" placeholder and should be
 *     repaired manually via `scripts/link-auth0-to-members.mjs`.
 *   - Never throws: any failure (tenant not provisioned, DB unavailable) is
 *     swallowed so an unrelated infra hiccup cannot block a successful login.
 *
 * Owner connection (BYPASSRLS) is used for the same chicken-and-egg reason as
 * `resolve-tenant.ts`: `app.tenant_id` is not bound when the session is built.
 */

import { getOwnerPool } from "@/lib/db/owner-pool";
import { resolveTenantIdByAuth0Org } from "./resolve-tenant";

const TTL_MS = 5 * 60 * 1000; // 5 minutes — matches the tenant resolver cache.

interface CacheEntry {
  cachedAt: number;
}

/** Keyed by `${orgId}|${sub}` — one entry per (tenant, user). */
const _cache = new Map<string, CacheEntry>();

/**
 * Clears the in-process bootstrap cache. Used in tests.
 * @internal
 */
export function clearMemberLinkCache(): void {
  _cache.clear();
}

/**
 * Stamps `members.auth0_user_id` for the caller's row if it is still NULL.
 *
 * Idempotent and safe to call on every request — cached per (orgId, sub) for
 * 5 minutes, after which a single indexed UPDATE runs (a no-op once linked).
 *
 * @param orgId - Auth0 `org_id` claim from the JWT.
 * @param sub   - Auth0 user id (the `sub` claim).
 * @param email - Auth0 `email` claim. Required to match the unlinked row.
 */
export async function ensureMemberLinked(
  orgId: string,
  sub: string,
  email: string,
): Promise<void> {
  if (!orgId || !sub || !email) return;

  const cacheKey = `${orgId}|${sub}`;
  const cached = _cache.get(cacheKey);
  if (cached !== undefined && Date.now() - cached.cachedAt < TTL_MS) {
    return;
  }

  try {
    const tenantId = await resolveTenantIdByAuth0Org(orgId);
    const pool = getOwnerPool();
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE members
            SET auth0_user_id = $1, updated_at = now()
          WHERE tenant_id = $2
            AND lower(email) = lower($3)
            AND auth0_user_id IS NULL
            AND deleted_at IS NULL`,
        [sub, tenantId, email],
      );
    } finally {
      client.release();
    }
  } catch {
    // Tenant not provisioned, DB unavailable, etc. — silent.
    // Default-deny preserved: an unlinked member sees the placeholder UI.
  }

  _cache.set(cacheKey, { cachedAt: Date.now() });
}
