/**
 * Typed error classes for the notifications subsystem.
 *
 * Follow the same shape as `AiGatewayNotConfiguredError` in `lib/ai/gateway.ts`:
 * each class carries `override readonly name` so callers can discriminate by
 * name without an `instanceof` chain that breaks across module boundaries.
 */

// ---------------------------------------------------------------------------
// EmailSendError
// ---------------------------------------------------------------------------

/**
 * Thrown when Resend returns a 4xx or 5xx response for a send attempt.
 * The `statusCode` and `errorCode` are forwarded from the Resend API response.
 */
export class EmailSendError extends Error {
  override readonly name = "EmailSendError";

  constructor(
    public readonly statusCode: number | null,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// EmailVolumeCapError
// ---------------------------------------------------------------------------

/**
 * Thrown when a tenant has reached their monthly email send cap
 * (`tenants.email_monthly_cap`). Maps to HTTP 402 in `handleServerError`.
 */
export class EmailVolumeCapError extends Error {
  override readonly name = "EmailVolumeCapError";

  constructor(public readonly tenantId: string) {
    super(`Monthly email volume cap reached for tenant ${tenantId}`);
  }
}

// ---------------------------------------------------------------------------
// RecipientSuppressedError
// ---------------------------------------------------------------------------

/**
 * Thrown when a recipient cannot receive email due to a permanent bounce
 * or complaint (`members.email_status = 'bouncing' | 'complained'`).
 * Maps to HTTP 409 in `handleServerError`.
 */
export class RecipientSuppressedError extends Error {
  override readonly name = "RecipientSuppressedError";

  constructor(public readonly memberId: string) {
    super(`Member ${memberId} is suppressed and cannot receive email`);
  }
}

// ---------------------------------------------------------------------------
// DraftValidationError
// ---------------------------------------------------------------------------

/**
 * Thrown when an AI-drafted patron email fails token validation
 * (e.g. missing `{{due_date}}` when `has_due_date` is required).
 * Maps to HTTP 422 in `handleServerError`.
 */
export class DraftValidationError extends Error {
  override readonly name = "DraftValidationError";

  constructor(public readonly issues: ReadonlyArray<string>) {
    super(`Draft validation failed: ${issues.join("; ")}`);
  }
}
