/**
 * next-safe-action v7 clients — the entry points for all Server Actions.
 *
 * Two clients:
 *   - `publicActionClient` — base client; Zod parse + error handling. No auth gate.
 *   - `actionClient`       — extends public with auth middleware + CASL permission check.
 *
 * Usage in a Server Action file:
 *
 *   export const createBook = actionClient
 *     .schema(CreateBookSchema)
 *     .metadata({ permission: "book:create" })
 *     .action(async ({ parsedInput, ctx }) => {
 *       return withTenantTx(ctx.tenantCtx, async (tx, txCtx) => { ... });
 *     });
 *
 * The `ctx` injected by `actionClient` has shape:
 *   { session: Session; ability: AppAbility; tenantCtx: TenantCtx }
 *
 * REQ-01-03 a: CASL Ability compiled per request.
 * REQ-01-05: PermissionDeniedError if ability.can() is false.
 */

import {
  BookHasActiveLoanError,
  BookNotFoundError,
  IsbnInvalidError,
  OptimisticConcurrencyError,
} from "@/lib/domain/books/errors";
import {
  HoldAlreadyExistsError,
  HoldNotFoundError,
  HoldNotPlaceableError,
  HoldOwnershipDeniedError,
} from "@/lib/domain/holds/errors";
import {
  BookAlreadyBorrowedError,
  BookWithdrawnError,
  LoanAlreadyReturnedError,
  LoanNotFoundError,
  MemberNotActiveError,
  RenewalBlockedByHoldError,
  RenewalLimitReachedError,
} from "@/lib/domain/loans/errors";
import {
  LastTenantAdminError,
  MemberAlreadyApprovedError,
  MemberAlreadyExistsError,
  MemberAlreadyRejectedError,
  MemberNotFoundError,
  MemberNotPendingError,
  MemberOwnershipDeniedError,
} from "@/lib/domain/members/errors";
import {
  EmbeddingFailedError,
  SearchFeatureDisabledError,
  SearchQueryTooShortError,
} from "@/lib/domain/search/errors";
import {
  DraftValidationError,
  EmailVolumeCapError,
  RecipientSuppressedError,
} from "@/lib/notifications/errors";
import { ActionMetadataValidationError, createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { buildAbility } from "./ability";
import type { AppAbility } from "./ability";
import {
  DevBypassNoTenantsError,
  OrganizationMembershipRequiredError,
  PermissionDeniedError,
  TenantNotProvisionedError,
  UnauthorizedError,
} from "./errors";
import { parsePermission } from "./permission";
import { requireSession, sessionToTenantCtx } from "./session";
import type { Session, TenantCtx } from "./types";

// ---------------------------------------------------------------------------
// Metadata schema (Zod)
// ---------------------------------------------------------------------------

/**
 * Zod schema for action metadata. Every protected action must supply
 * `.metadata({ permission: "subject:action" })`.
 */
const ActionMetadataSchema = z.object({
  permission: z.string().min(1),
});

export type ActionMetadata = z.infer<typeof ActionMetadataSchema>;

// ---------------------------------------------------------------------------
// ProblemDetails error mapper
// ---------------------------------------------------------------------------

/**
 * Maps domain errors to RFC 7807 ProblemDetails-shaped `serverError` strings.
 *
 * next-safe-action passes `serverError` back to the client as whatever
 * `handleServerError` returns. We return a JSON-encoded ProblemDetails object
 * so clients can parse the `detail` field and display the missing permission
 * name (REQ-01-05).
 *
 * Error → HTTP status mapping:
 *   PermissionDeniedError               → 403
 *   UnauthorizedError                   → 401
 *   OrganizationMembershipRequiredError → 403
 *   TenantNotProvisionedError           → 409 Conflict
 *   (everything else)                   → 500 (no internal detail leaked)
 */
function handleServerError(err: Error): string {
  if (err instanceof PermissionDeniedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Permission Denied",
      status: 403,
      code: "PERMISSION_DENIED",
      detail: err.message,
    });
  }

  if (err instanceof UnauthorizedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      code: "UNAUTHORIZED",
      detail: err.message,
    });
  }

  if (err instanceof OrganizationMembershipRequiredError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Organization Membership Required",
      status: 403,
      code: "ORG_MEMBERSHIP_REQUIRED",
      detail: err.message,
    });
  }

  if (err instanceof TenantNotProvisionedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Tenant Not Provisioned",
      status: 409,
      code: "TENANT_NOT_PROVISIONED",
      detail: "Your library is not yet provisioned. Please contact your administrator.",
    });
  }

  if (err instanceof DevBypassNoTenantsError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Service Unavailable",
      status: 503,
      code: "DEV_BYPASS_NO_TENANTS",
      detail: err.message,
    });
  }

  if (err instanceof BookNotFoundError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "BOOK_NOT_FOUND",
      detail: err.message,
    });
  }

  if (err instanceof OptimisticConcurrencyError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "OPTIMISTIC_CONCURRENCY",
      detail: err.message,
    });
  }

  if (err instanceof BookHasActiveLoanError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Unprocessable Entity",
      status: 422,
      code: "BOOK_HAS_ACTIVE_LOAN",
      detail: err.message,
    });
  }

  if (err instanceof IsbnInvalidError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Unprocessable Entity",
      status: 422,
      code: "ISBN_INVALID",
      detail: err.message,
    });
  }

  // --- Circulation errors (Spec 03) ---

  if (err instanceof BookAlreadyBorrowedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "BOOK_ALREADY_BORROWED",
      detail: err.message,
    });
  }

  if (err instanceof BookWithdrawnError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Gone",
      status: 410,
      code: "BOOK_WITHDRAWN",
      detail: err.message,
    });
  }

  if (err instanceof MemberNotActiveError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      code: "MEMBER_NOT_ACTIVE",
      detail: err.message,
    });
  }

  if (err instanceof LoanNotFoundError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "LOAN_NOT_FOUND",
      detail: err.message,
    });
  }

  if (err instanceof LoanAlreadyReturnedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "LOAN_ALREADY_RETURNED",
      detail: err.message,
    });
  }

  if (err instanceof RenewalLimitReachedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "RENEWAL_LIMIT_REACHED",
      detail: err.message,
    });
  }

  if (err instanceof RenewalBlockedByHoldError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "RENEWAL_BLOCKED_BY_HOLD",
      detail: err.message,
    });
  }

  if (err instanceof HoldNotFoundError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "HOLD_NOT_FOUND",
      detail: err.message,
    });
  }

  if (err instanceof HoldAlreadyExistsError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "HOLD_ALREADY_EXISTS",
      detail: err.message,
    });
  }

  if (err instanceof HoldNotPlaceableError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Unprocessable Entity",
      status: 422,
      code: "HOLD_NOT_PLACEABLE",
      detail: err.message,
    });
  }

  if (err instanceof HoldOwnershipDeniedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      code: "HOLD_OWNERSHIP_DENIED",
      detail: err.message,
    });
  }

  // --- Member management errors (Spec 04) ---

  if (err instanceof MemberNotFoundError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "MEMBER_NOT_FOUND",
      detail: err.message,
    });
  }

  if (err instanceof MemberAlreadyExistsError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "MEMBER_ALREADY_EXISTS",
      // Opaque detail — no field name leaked to avoid enumeration.
      detail: "An account with this information already exists in this library",
    });
  }

  if (err instanceof MemberNotPendingError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Unprocessable Entity",
      status: 422,
      code: "MEMBER_NOT_PENDING",
      detail: err.message,
    });
  }

  if (err instanceof MemberAlreadyApprovedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "MEMBER_ALREADY_APPROVED",
      detail: err.message,
    });
  }

  if (err instanceof MemberAlreadyRejectedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "MEMBER_ALREADY_REJECTED",
      detail: err.message,
    });
  }

  if (err instanceof MemberOwnershipDeniedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      code: "MEMBER_OWNERSHIP_DENIED",
      detail: err.message,
    });
  }

  if (err instanceof LastTenantAdminError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "LAST_TENANT_ADMIN",
      detail: err.message,
    });
  }

  // --- Search errors (Spec 05) ---

  if (err instanceof SearchQueryTooShortError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Unprocessable Entity",
      status: 422,
      code: "SEARCH_QUERY_TOO_SHORT",
      detail: err.message,
    });
  }

  if (err instanceof SearchFeatureDisabledError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "SEARCH_FEATURE_DISABLED",
      detail: err.message,
    });
  }

  if (err instanceof EmbeddingFailedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Service Unavailable",
      status: 503,
      code: "EMBEDDING_FAILED",
      detail: "Embedding service temporarily unavailable",
    });
  }

  // --- Notification errors (Spec 07) ---

  if (err instanceof EmailVolumeCapError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Payment Required",
      status: 402,
      code: "EMAIL_VOLUME_CAP",
      detail:
        "Your library has reached its monthly email send limit. Please contact your administrator.",
    });
  }

  if (err instanceof DraftValidationError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Unprocessable Entity",
      status: 422,
      code: "DRAFT_INVALID",
      detail: err.message,
    });
  }

  if (err instanceof RecipientSuppressedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "RECIPIENT_SUPPRESSED",
      detail: err.message,
    });
  }

  // SECURITY: ActionMetadataValidationError is thrown by next-safe-action when an
  // action is defined without .metadata() (or with a metadata value that fails Zod
  // validation). Without this branch it would fall through to the generic 500 handler,
  // which is a confusing signal — the root cause is always a programming error (missing
  // .metadata() on a protected action). Map it to 403 Permission Denied so the failure
  // mode is unmistakable and consistent with PermissionDeniedError.
  if (err instanceof ActionMetadataValidationError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Permission Denied",
      status: 403,
      code: "MISSING_PERMISSION_METADATA",
      detail: "missing permission: <no permission metadata declared>",
    });
  }

  // All other errors: generic 500, no internal detail leaked to client.
  return JSON.stringify({
    type: "about:blank",
    title: "Internal Server Error",
    status: 500,
    code: "INTERNAL_ERROR",
    detail: "An unexpected error occurred",
  });
}

// ---------------------------------------------------------------------------
// publicActionClient
// ---------------------------------------------------------------------------

/**
 * Base action client — Zod schema parsing + typed error handling.
 * No auth gate. Use for actions that are genuinely public.
 */
export const publicActionClient = createSafeActionClient({
  handleServerError,
});

// ---------------------------------------------------------------------------
// actionClient
// ---------------------------------------------------------------------------

/**
 * Protected action client — adds:
 *   1. Auth middleware: calls `requireSession()`, throws `UnauthorizedError` if not authed.
 *   2. Builds `AppAbility` from `session.roles` (via the ROLE_PERMISSIONS table).
 *   3. Resolves org_id → UUID via `sessionToTenantCtx` (async, cached).
 *   4. Permission middleware: reads `metadata.permission`, checks `ability.can()`.
 *
 * The `ctx` available in `.action(({ parsedInput, ctx }) => ...)` has:
 *   { session: Session; ability: AppAbility; tenantCtx: TenantCtx }
 *
 * SECURITY (metadata guard): If an action is defined without `.metadata(...)`,
 * the `metadata` object passed by next-safe-action v7 can be undefined or {}.
 * We explicitly check for a non-empty permission string and throw
 * PermissionDeniedError — NOT TypeError — so the failure mode is a clear 403
 * rather than a confusing 500. This prevents a future contributor from silently
 * bypassing authz by omitting `.metadata()`.
 */
export const actionClient = createSafeActionClient({
  handleServerError,
  defineMetadataSchema() {
    return ActionMetadataSchema;
  },
})
  .use(async ({ next }) => {
    // --- Auth + tenant resolution middleware ---
    const session = await requireSession();
    const ability = buildAbility(session.roles);
    // sessionToTenantCtx is now async: resolves org_id → UUID via owner connection.
    // Cached for 5 min in-process; first call does one DB round-trip.
    const tenantCtx = await sessionToTenantCtx(session);

    return next({
      ctx: {
        session,
        ability,
        tenantCtx,
      },
    });
  })
  .use(async ({ next, ctx, metadata }) => {
    // --- Permission middleware ---

    // SECURITY: Explicit guard against missing/malformed metadata. In next-safe-action
    // v7, an action defined without .metadata() may receive undefined or {} here.
    // Fail closed with PermissionDeniedError (→ 403) rather than letting a TypeError
    // bubble to the generic 500 handler — the latter would pass silently in some error
    // logging setups and leave the behaviour undefined.
    if (!metadata || typeof metadata.permission !== "string" || metadata.permission.length === 0) {
      throw new PermissionDeniedError("<no permission metadata declared>");
    }

    const { permission } = metadata;

    // Use the shared parsePermission — same logic as ability.ts / buildAbility,
    // preventing the two parsers from drifting.
    const parsed = parsePermission(permission);
    if (!parsed) {
      // Unrecognised "subject:action" string is a programming error, not a user error.
      throw new PermissionDeniedError(permission);
    }

    const ability = ctx.ability as AppAbility;

    if (!ability.can(parsed.action, parsed.subject)) {
      throw new PermissionDeniedError(permission);
    }

    return next({ ctx });
  });

// ---------------------------------------------------------------------------
// Re-export context type for use in action handlers
// ---------------------------------------------------------------------------

export interface ActionCtx {
  session: Session;
  ability: AppAbility;
  tenantCtx: TenantCtx;
}
