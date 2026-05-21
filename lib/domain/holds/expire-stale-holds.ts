/**
 * expireStaleHolds — marks overdue 'ready' holds as 'expired' and promotes
 * the next queued hold for each affected book (REQ-03-06).
 *
 * Called by the hourly worker (Spec 03 Run C, wired via Vercel Workflow DevKit).
 * Uses FOR UPDATE SKIP LOCKED to be safe under concurrent worker runs.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { holds } from "@/lib/db/schema/holds";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, lt } from "drizzle-orm";
import { promoteNextHold } from "./promote-next-hold";

export interface ExpireStaleHoldsResult {
  expiredCount: number;
  promotedCount: number;
}

/**
 * Expires all ready holds whose ready_until < NOW() and promotes the next
 * queued hold for each affected book.
 */
export async function expireStaleHolds(
  tx: TxClient,
  ctx: TenantCtx,
): Promise<ExpireStaleHoldsResult> {
  const now = new Date();

  // Find + lock stale ready holds (SKIP LOCKED — idempotent under concurrent workers).
  const staleHolds = await tx
    .select({ id: holds.id, bookId: holds.bookId, memberId: holds.memberId })
    .from(holds)
    .where(and(eq(holds.status, "ready"), lt(holds.readyUntil, now)))
    .for("update", { skipLocked: true });

  let promotedCount = 0;

  for (const stale of staleHolds) {
    // Mark expired.
    await tx.update(holds).set({ status: "expired", updatedAt: now }).where(eq(holds.id, stale.id));

    await writeAuditLog(tx, ctx, {
      action: "hold.expired",
      subjectType: "hold",
      subjectId: stale.id,
      afterJson: { bookId: stale.bookId, memberId: stale.memberId },
    });

    // Promote the next in queue for this book.
    const result = await promoteNextHold(tx, ctx, stale.bookId);
    if (result.promoted) promotedCount++;
  }

  return { expiredCount: staleHolds.length, promotedCount };
}
