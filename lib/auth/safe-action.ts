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

import { ActionMetadataValidationError, createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { buildAbility } from "./ability";
import type { AppAbility } from "./ability";
import {
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
      detail: err.message,
    });
  }

  if (err instanceof UnauthorizedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: err.message,
    });
  }

  if (err instanceof OrganizationMembershipRequiredError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Organization Membership Required",
      status: 403,
      detail: err.message,
    });
  }

  if (err instanceof TenantNotProvisionedError) {
    return JSON.stringify({
      type: "about:blank",
      title: "Tenant Not Provisioned",
      status: 409,
      detail: "Your library is not yet provisioned. Please contact your administrator.",
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
      detail: "missing permission: <no permission metadata declared>",
    });
  }

  // All other errors: generic 500, no internal detail leaked to client.
  return JSON.stringify({
    type: "about:blank",
    title: "Internal Server Error",
    status: 500,
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
