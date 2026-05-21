/**
 * Typed error classes for the auth layer.
 *
 * These are caught by `handleServerError` in safe-action.ts and mapped to
 * RFC 7807 ProblemDetails-shaped server error envelopes before reaching the client.
 *
 * Error → HTTP status mapping (enforced in safe-action.ts handleServerError):
 *   UnauthorizedError                  → 401
 *   PermissionDeniedError              → 403
 *   OrganizationMembershipRequiredError → 403
 *   TenantNotProvisionedError          → 409 Conflict
 *   (everything else)                  → 500
 */

// ---------------------------------------------------------------------------
// UnauthorizedError
// ---------------------------------------------------------------------------

/**
 * Thrown when a protected action is called without an active session.
 * Maps to HTTP 401.
 */
export class UnauthorizedError extends Error {
  override readonly name = "UnauthorizedError";

  constructor(message = "Authentication required") {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// PermissionDeniedError
// ---------------------------------------------------------------------------

/**
 * Thrown when the session exists but the user lacks the required CASL permission.
 * Maps to HTTP 403. Carries the missing permission string for the error body.
 *
 * REQ-01-05: "reject the request with HTTP 403 and a ProblemDetails body naming
 * the missing permission."
 */
export class PermissionDeniedError extends Error {
  override readonly name = "PermissionDeniedError";
  readonly permission: string;

  constructor(permission: string) {
    super(`missing permission: ${permission}`);
    this.permission = permission;
  }
}

// ---------------------------------------------------------------------------
// OrganizationMembershipRequiredError
// ---------------------------------------------------------------------------

/**
 * Thrown when the JWT is valid but lacks an `org_id` claim — the user is not a
 * member of any Auth0 Organization yet.
 *
 * This surfaces a friendly "your library is not yet provisioned" message via
 * middleware (Spec 01 §7 edge case).
 */
export class OrganizationMembershipRequiredError extends Error {
  override readonly name = "OrganizationMembershipRequiredError";

  constructor(
    message = "No organization membership found in JWT. Your library may not be provisioned yet.",
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// TenantNotProvisionedError
// ---------------------------------------------------------------------------

/**
 * Thrown by `resolveTenantIdByAuth0Org` when the Auth0 org_id has no matching
 * row in the `tenants` table.
 *
 * This means the Auth0 Organization was created but the Stack DB row was never
 * inserted (e.g., provisionTenant failed or was not called). The user is in a
 * real Auth0 org but cannot use the app until a system_owner runs provisionTenant.
 *
 * Maps to HTTP 409 Conflict in handleServerError — not 401 (user is authenticated)
 * and not 403 (user has valid org membership) but the resource is not ready.
 */
export class TenantNotProvisionedError extends Error {
  override readonly name = "TenantNotProvisionedError";

  constructor(public readonly orgId: string) {
    super(
      `Tenant for Auth0 org "${orgId}" has not been provisioned in Stack yet. Please contact your administrator.`,
    );
  }
}
