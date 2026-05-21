/**
 * promoteNextHold — internal helper called by returnBook and expireStaleHolds.
 *
 * Promotes the oldest queued hold for a book to 'ready' when the book becomes
 * available. Uses FOR UPDATE SKIP LOCKED to be safe under concurrent workers.
 *
 * REQ-03-03: When a loan is returned, check holds ordered by queued_at, take
 * the head row, set status='ready' and ready_until = NOW() + hold_pickup_hours.
 *
 * TODO (Spec 07): emit('hold.promoted', { holdId, memberId, tenantId }) after commit.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { holds } from "@/lib/db/schema/holds";
import { tenants } from "@/lib/db/schema/tenants";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, asc, eq } from "drizzle-orm";

export interface PromoteNextHoldResult {
  promoted: boolean;
  holdId: string | null;
}

/**
 * Promotes the next queued hold for the given book to 'ready'.
 *
 * @param tx     - Active tenant transaction.
 * @param ctx    - Tenant context.
 * @param bookId - The book whose hold queue to advance.
 */
export async function promoteNextHold(
  tx: TxClient,
  ctx: TenantCtx,
  bookId: string,
): Promise<PromoteNextHoldResult> {
  // Lock the oldest queued hold (SKIP LOCKED prevents double-promotion under concurrent workers).
  const [nextHold] = await tx
    .select({ id: holds.id, memberId: holds.memberId })
    .from(holds)
    .where(and(eq(holds.bookId, bookId), eq(holds.status, "queued")))
    .orderBy(asc(holds.queuedAt))
    .limit(1)
    .for("update", { skipLocked: true });

  if (!nextHold) {
    return { promoted: false, holdId: null };
  }

  // Read hold_pickup_hours from tenant policy.
  const [tenant] = await tx
    .select({ holdPickupHours: tenants.holdPickupHours })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId));

  const holdPickupHours = tenant?.holdPickupHours ?? 72;
  const readyUntil = new Date(Date.now() + holdPickupHours * 60 * 60 * 1000);

  await tx
    .update(holds)
    .set({
      status: "ready",
      readyUntil,
      updatedAt: new Date(),
    })
    .where(eq(holds.id, nextHold.id));

  await writeAuditLog(tx, ctx, {
    action: "hold.promoted",
    subjectType: "hold",
    subjectId: nextHold.id,
    afterJson: {
      bookId,
      memberId: nextHold.memberId,
      readyUntil: readyUntil.toISOString(),
    },
  });

  // TODO (Spec 07): emit('hold.promoted', { holdId: nextHold.id, memberId: nextHold.memberId, tenantId: ctx.tenantId })

  return { promoted: true, holdId: nextHold.id };
}
