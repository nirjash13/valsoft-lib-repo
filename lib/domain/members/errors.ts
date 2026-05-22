/**
 * Typed domain errors for the members module (Spec 04).
 *
 * HTTP status mapping (enforced in lib/auth/safe-action.ts handleServerError):
 *   MemberNotFoundError            → 404
 *   MemberAlreadyExistsError       → 409
 *   MemberNotPendingError          → 422 (state-machine violation)
 *   MemberAlreadyApprovedError     → 409
 *   MemberAlreadyRejectedError     → 409
 *   MemberOwnershipDeniedError     → 403
 *   LastTenantAdminError           → 409 (invariant: cannot remove last admin)
 */

export class MemberNotFoundError extends Error {
  override readonly name = "MemberNotFoundError";
  readonly code = "MEMBER_NOT_FOUND";

  constructor(public readonly memberId: string) {
    super(`Member ${memberId} not found`);
  }
}

export class MemberAlreadyExistsError extends Error {
  override readonly name = "MemberAlreadyExistsError";
  readonly code = "MEMBER_ALREADY_EXISTS";

  /**
   * @param field - "email" or "auth0_user_id" — which uniqueness constraint fired.
   *               Never leak this detail to unauthenticated callers (enumeration risk).
   *               Internal use only.
   */
  constructor(public readonly field: "email" | "auth0_user_id") {
    super(`A member with this ${field} already exists in this tenant`);
  }
}

/**
 * Thrown when approve/reject is called on a member whose status is not 'pending'.
 * Maps to 422 Unprocessable Entity — the request is well-formed but violates the
 * approval state machine.
 */
export class MemberNotPendingError extends Error {
  override readonly name = "MemberNotPendingError";
  readonly code = "MEMBER_NOT_PENDING";

  constructor(
    public readonly memberId: string,
    public readonly currentStatus: string,
  ) {
    super(`Member ${memberId} is not pending (current status: ${currentStatus})`);
  }
}

export class MemberAlreadyApprovedError extends Error {
  override readonly name = "MemberAlreadyApprovedError";
  readonly code = "MEMBER_ALREADY_APPROVED";

  constructor(public readonly memberId: string) {
    super(`Member ${memberId} is already approved`);
  }
}

export class MemberAlreadyRejectedError extends Error {
  override readonly name = "MemberAlreadyRejectedError";
  readonly code = "MEMBER_ALREADY_REJECTED";

  constructor(public readonly memberId: string) {
    super(`Member ${memberId} has already been rejected`);
  }
}

/**
 * Thrown when a member attempts to update another member's profile.
 * Maps to 403 Forbidden.
 */
export class MemberOwnershipDeniedError extends Error {
  override readonly name = "MemberOwnershipDeniedError";
  readonly code = "MEMBER_OWNERSHIP_DENIED";

  constructor(
    public readonly requestedMemberId: string,
    public readonly callerMemberId: string,
  ) {
    super(`Member ${callerMemberId} cannot update profile of member ${requestedMemberId}`);
  }
}

/**
 * Thrown when an action would remove the last tenant_admin from a tenant.
 * Maps to 409 Conflict — the invariant "at least one tenant_admin must exist" is violated.
 */
export class LastTenantAdminError extends Error {
  override readonly name = "LastTenantAdminError";
  readonly code = "LAST_TENANT_ADMIN";

  constructor(public readonly tenantId: string) {
    super(`Cannot demote/deactivate the last tenant_admin for tenant ${tenantId}`);
  }
}
