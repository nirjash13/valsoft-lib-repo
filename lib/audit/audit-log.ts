/**
 * Audit log writer — the ONLY place in app code that inserts into `audit_log`.
 *
 * Domain code and Server Actions MUST call one of these functions; they MUST NOT
 * write to `audit_log` directly. This centralises the security invariants:
 *   - `tenantId` and `actorId` come from `ctx` or an explicit `AuditOverride`,
 *     NOT from the caller's `entry`.
 *   - The insert runs inside the caller's transaction, ensuring atomicity (NFR-01-04).
 *   - The `audit_log` table has REVOKE UPDATE/DELETE enforced by DB triggers (Run A).
 *
 * Two entry points:
 *   - `writeAuditLog(tx, ctx, entry)` — normal path; tenantId+actorId from TenantCtx.
 *   - `writeSystemAuditLog(tx, override, entry)` — system_owner path; explicit override.
 *     Use ONLY from withSystemOwnerTx callbacks where ctx is the operator's session,
 *     not the target tenant. The override must come from trusted internal state,
 *     never from user input.
 *
 * REQ-01-06: "write a single audit_log row … inside the same transaction."
 * NFR-01-04: "the matching audit row commits in the same transaction."
 */

import type { TenantCtx, TenantId, UserId } from "@/lib/auth/types";
import { auditLog } from "@/lib/db/schema/audit-log";
import type { SystemOwnerTxClient } from "@/lib/db/with-system-owner-tx";
import type { TxClient } from "@/lib/db/with-tenant-tx";

// ---------------------------------------------------------------------------
// AuditEntry
// ---------------------------------------------------------------------------

/**
 * Caller-supplied fields for one audit log row.
 *
 * `tenantId` and `actorId` are intentionally absent — they come from `ctx`
 * (or an explicit AuditOverride for system_owner paths) and are NOT
 * caller-controlled, preventing privilege escalation by a caller passing a
 * different tenant_id.
 */
export interface AuditEntry {
  /** The authoritative action name, e.g. "book.created", "loan.checkout". */
  readonly action: string;
  /** The type of entity affected, e.g. "book", "loan", "member". */
  readonly subjectType: string;
  /** The UUID of the affected entity, if known. May be omitted for bulk actions. */
  readonly subjectId?: string | null;
  /** The entity's state before the mutation, for update/delete actions. */
  readonly beforeJson?: unknown;
  /** The entity's state after the mutation, for create/update actions. */
  readonly afterJson?: unknown;
}

// ---------------------------------------------------------------------------
// AuditOverride
// ---------------------------------------------------------------------------

/**
 * Explicit tenantId + actorId for system_owner audit writes.
 *
 * SECURITY: This override is opt-in and must only be constructed from trusted
 * internal state (i.e., the newly created tenant's UUID + the operator's user id).
 * It must NEVER be constructed from user-supplied input. The override path is
 * intentionally a separate function (`writeSystemAuditLog`) to make privileged
 * audit writes visible in diffs and code review.
 */
export interface AuditOverride {
  readonly tenantId: TenantId;
  readonly actorId: UserId;
}

// ---------------------------------------------------------------------------
// writeAuditLog
// ---------------------------------------------------------------------------

/**
 * Inserts one `audit_log` row inside the provided transaction.
 *
 * @param tx    - The active transaction client from `withTenantTx`.
 * @param ctx   - The request-scoped tenant context (provides tenantId + actorId).
 * @param entry - The caller-supplied audit entry fields.
 *
 * @throws If the insert fails (e.g., FK violation). Callers should allow the
 *         error to propagate so the outer transaction rolls back atomically.
 */
export async function writeAuditLog(
  tx: TxClient,
  ctx: TenantCtx,
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId ?? null,
    beforeJson: entry.beforeJson !== undefined ? entry.beforeJson : null,
    afterJson: entry.afterJson !== undefined ? entry.afterJson : null,
    // occurredAt defaults to now() at the DB layer
  });
}

// ---------------------------------------------------------------------------
// writeSystemAuditLog
// ---------------------------------------------------------------------------

/**
 * Inserts one `audit_log` row inside a system_owner (withSystemOwnerTx) transaction.
 *
 * Use ONLY from `withSystemOwnerTx` callbacks — the normal `writeAuditLog` cannot
 * be used there because `withSystemOwnerTx` operates across tenant boundaries (e.g.,
 * tenant provisioning writes to the newly created tenant's audit log, not the
 * operator's tenant). The `override` carries the target tenant's UUID and the
 * operator's user id.
 *
 * SECURITY: The `override` object must be constructed from trusted internal state
 * (the new tenant's UUID from the DB insert return + the operator's session.sub).
 * It must NEVER be derived from user-supplied input. Privilege escalation via
 * this path would allow an operator to write audit rows attributed to any tenant
 * and actor. Code review must verify the construction site.
 *
 * @param tx       - The system_owner transaction client from `withSystemOwnerTx`.
 * @param override - Explicit { tenantId, actorId } from trusted internal state.
 * @param entry    - The caller-supplied audit entry fields.
 */
export async function writeSystemAuditLog(
  tx: SystemOwnerTxClient,
  override: AuditOverride,
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: override.tenantId,
    actorId: override.actorId,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId ?? null,
    beforeJson: entry.beforeJson !== undefined ? entry.beforeJson : null,
    afterJson: entry.afterJson !== undefined ? entry.afterJson : null,
    // occurredAt defaults to now() at the DB layer
  });
}
