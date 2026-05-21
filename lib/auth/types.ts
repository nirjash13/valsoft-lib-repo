/**
 * Shared auth types referenced by session, ability, middleware, and safe-action.
 *
 * Deliberately minimal: no framework imports. Safe to import from Edge runtime.
 */

// ---------------------------------------------------------------------------
// Branded IDs
// ---------------------------------------------------------------------------

export type TenantId = string & { readonly __brand: "TenantId" };
export type UserId = string & { readonly __brand: "UserId" };

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * The verified Auth0 session, trimmed to what application code needs.
 *
 * - `sub`   — Auth0 user id (stable, opaque string)
 * - `orgId` — Auth0 org_id claim (maps 1:1 to `tenants.auth0_org_id`)
 * - `email` — user's email (display only — do not use as an identity key)
 * - `roles` — organization roles from the JWT `roles` custom claim.
 *             Resolved to fine-grained permissions by `permissionsForRoles`
 *             (see lib/auth/permission.ts). We deliberately carry roles, not
 *             permissions, because Auth0 Post-Login Actions only expose
 *             `event.authorization.roles: string[]`.
 */
export interface Session {
  readonly sub: UserId;
  readonly orgId: TenantId;
  readonly email: string;
  readonly roles: readonly string[];
}

// ---------------------------------------------------------------------------
// TenantCtx (used by withTenantTx)
// ---------------------------------------------------------------------------

/**
 * Minimal context forwarded into `withTenantTx`.
 * `tenantId` is the Postgres UUID that matches `tenants.id` (not the Auth0 org_id text).
 * In Run B we forward the Auth0 org_id directly — the DB lookup to resolve
 * org_id → UUID is deferred to Run C when full provisioning is wired.
 */
export interface TenantCtx {
  readonly tenantId: string;
  readonly userId: string;
}
