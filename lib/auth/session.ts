/**
 * Auth0 session helpers — server-side only (Node.js functions; NOT Edge).
 *
 * Reads the Auth0 session via the Auth0Client singleton in `lib/auth0.ts`.
 * The SDK verifies the JWT signature against JWKS and handles silent refresh
 * (REQ-01-08). We extract the application-level claims we need and return a typed
 * `Session` object.
 *
 * IMPORTANT: `auth0.getSession()` in App Router reads from the Next.js request
 * context automatically in RSC / Server Actions — no explicit req/res needed.
 *
 * DEV BYPASS: Set DEV_AUTH_BYPASS=1 in .env.local to skip Auth0 during local
 * development (Auth0 Post-Login Action is not yet deployed). Forbidden in production.
 */

import { auth0 } from "@/lib/auth0";
import {
  DevBypassNoTenantsError,
  OrganizationMembershipRequiredError,
  UnauthorizedError,
} from "./errors";
import { resolveTenantIdByAuth0Org } from "./resolve-tenant";
import type { Session, TenantCtx, TenantId, UserId } from "./types";

// ---------------------------------------------------------------------------
// Dev-mode bypass
// ---------------------------------------------------------------------------

/**
 * DEV_BYPASS_ORG_ID is the Auth0 org_id placeholder used for the dev stub session.
 * The resolve-tenant lookup will find the first tenant in the DB that matches,
 * or we fall back to querying by first-row in sessionToTenantCtx.
 *
 * The stub org_id must match a real tenants.auth0_org_id in the dev DB.
 * Set DEV_BYPASS_ORG_ID in .env.local to override; defaults to "org_dev_demo".
 */
const DEV_BYPASS_ORG_ID = (process.env.DEV_BYPASS_ORG_ID ?? "org_dev_demo") as TenantId;

/** Suppress repeated dev-bypass warnings after the first resolution per process. */
let devBypassWarnedOnce = false;

const DEV_STUB_SESSION: Session = {
  sub: "dev|bypass-user" as UserId,
  orgId: DEV_BYPASS_ORG_ID,
  email: "dev@stack.local",
  roles: ["tenant_admin"],
};

function isDevBypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.DEV_AUTH_BYPASS === "1";
}

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

/**
 * Returns the verified Auth0 session or `null` if the user is unauthenticated.
 *
 * Extracts `sub`, `org_id`, `email`, and `roles` from the JWT claims.
 * Returns `null` if no session exists.
 *
 * Edge case (Spec 01 §7): if the JWT is valid but carries no `org_id`, the user
 * is not a member of any organization yet. We throw
 * `OrganizationMembershipRequiredError` so callers can surface a friendly
 * "library not yet provisioned" page rather than a cryptic 500.
 */
export async function getSession(): Promise<Session | null> {
  // DEV bypass: skip Auth0 entirely; return stub tenant_admin session.
  if (isDevBypassEnabled()) return DEV_STUB_SESSION;

  const raw = await auth0.getSession();
  if (!raw) return null;

  const user = raw.user;

  // org_id is set by Auth0 Organizations on the JWT. If missing, the user
  // authenticated but is not in any organization.
  const orgId = user.org_id;
  if (orgId === undefined || orgId === null || orgId === "") {
    throw new OrganizationMembershipRequiredError();
  }

  // roles[] is populated by an Auth0 Post-Login Action from
  // `event.authorization.roles`. We resolve roles → permissions in
  // `permissionsForRoles` (see lib/auth/permission.ts). Tolerate missing
  // (returns empty array) so unauthorized-by-default still works if the
  // Action hasn't been deployed yet.
  const rawRoles = user.roles;
  const roles: readonly string[] = Array.isArray(rawRoles)
    ? (rawRoles as unknown[]).filter((r): r is string => typeof r === "string")
    : [];

  const email = typeof user.email === "string" ? user.email : "";

  return {
    sub: user.sub as UserId,
    orgId: orgId as TenantId,
    email,
    roles,
  };
}

// ---------------------------------------------------------------------------
// requireSession
// ---------------------------------------------------------------------------

/**
 * Returns the verified session or throws `UnauthorizedError` if unauthenticated.
 *
 * Use in Server Actions and Route Handlers where a session is mandatory.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

// ---------------------------------------------------------------------------
// sessionToTenantCtx
// ---------------------------------------------------------------------------

/**
 * Converts a `Session` to the `TenantCtx` shape expected by `withTenantTx`.
 *
 * Resolves the Auth0 org_id (text, e.g. "org_abc123def") to the Postgres
 * `tenants.id` UUID via `resolveTenantIdByAuth0Org`. The resolved UUID is
 * cached in-process for 5 minutes.
 *
 * WHY async: the first call per org_id performs a DB round-trip via the owner
 * connection (DATABASE_URL_UNPOOLED, BYPASSRLS) because the app.tenant_id GUC
 * is not yet bound — querying tenants with the stack_app connection before the
 * GUC is set would trigger assert_tenant() and raise.
 *
 * @throws {TenantNotProvisionedError} if no tenants row matches session.orgId.
 */
export async function sessionToTenantCtx(session: Session): Promise<TenantCtx> {
  // DEV bypass: resolve tenant from env var or by querying the first seeded tenant.
  if (isDevBypassEnabled()) {
    // If DEV_BYPASS_TENANT_ID is explicitly set, use it directly (no DB round-trip).
    const envTenantId = process.env.DEV_BYPASS_TENANT_ID;
    if (envTenantId) {
      if (!devBypassWarnedOnce) {
        console.warn(
          `[DEV_AUTH_BYPASS] Resolved tenant: ${envTenantId} (auth0_org_id=${session.orgId}) — from DEV_BYPASS_TENANT_ID`,
        );
        devBypassWarnedOnce = true;
      }
      return { tenantId: envTenantId, userId: session.sub };
    }

    // Fall back to querying the first tenant (oldest by created_at).
    const { getOwnerPool } = await import("@/lib/db/owner-pool");
    const pool = getOwnerPool();
    const client = await pool.connect();
    try {
      const res = await client.query<{ id: string; auth0_org_id: string }>(
        "SELECT id, auth0_org_id FROM tenants ORDER BY created_at LIMIT 1",
      );
      if (res.rows.length === 0) {
        // No tenants seeded — throw a clear error rather than returning a zero-UUID
        // that silently produces empty RLS results and misleads smoke tests.
        throw new DevBypassNoTenantsError();
      }
      // biome-ignore lint/style/noNonNullAssertion: length check guarantees row
      const resolvedId = res.rows[0]!.id;
      if (!devBypassWarnedOnce) {
        console.warn(
          `[DEV_AUTH_BYPASS] Resolved tenant: ${resolvedId} (auth0_org_id=${session.orgId})`,
        );
        devBypassWarnedOnce = true;
      }
      return { tenantId: resolvedId, userId: session.sub };
    } finally {
      client.release();
    }
  }

  const tenantId = await resolveTenantIdByAuth0Org(session.orgId);
  return {
    tenantId,
    userId: session.sub,
  };
}
