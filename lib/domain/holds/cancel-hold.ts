/**
 * cancelHold — cancels a queued hold (librarian or hold owner).
 *
 * Authorization notes:
 *   - A member may cancel their own hold (CASL: hold:delete + ownership check).
 *   - A librarian may cancel any hold in the tenant (hold:delete, no ownership check).
 *   - Tenant admin may cancel any hold (hold:manage, no ownership check).
 * The CASL gate is enforced at the Server Action layer via metadata.permission.
 * Ownership is enforced here when callerMemberId is provided (member callers).
 * Librarians and admins pass callerMemberId = undefined to bypass the ownership check.
 *
 * Only 'queued' holds can be cancelled. 'ready' holds should be handled by
 * the return / expire worker path; attempting to cancel a 'ready' hold also
 * succeeds here (pragmatic: the librarian can cancel a ready hold for the member).
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { holds } from "@/lib/db/schema/holds";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, inArray } from "drizzle-orm";
import { HoldNotFoundError, HoldOwnershipDeniedError } from "./errors";

/**
 * Cancels an active (queued or ready) hold.
 *
 * @param callerMemberId - When provided (member callers), ownership is verified.
 *                         Pass undefined for librarians / admins to bypass the check.
 * @throws HoldNotFoundError         if the hold does not exist or is already expired/cancelled.
 * @throws HoldOwnershipDeniedError  if callerMemberId is set and does not match the hold owner.
 */
export async function cancelHold(
  tx: TxClient,
  ctx: TenantCtx,
  input: { holdId: string; callerMemberId?: string },
): Promise<void> {
  // Ownership check: members can only cancel their own holds.
  // Read the hold first (before updating) so we can verify ownership.
  if (input.callerMemberId !== undefined) {
    const [existing] = await tx
      .select({ memberId: holds.memberId })
      .from(holds)
      .where(and(eq(holds.id, input.holdId), inArray(holds.status, ["queued", "ready"])));

    if (!existing) {
      throw new HoldNotFoundError(input.holdId);
    }

    if (existing.memberId !== input.callerMemberId) {
      throw new HoldOwnershipDeniedError(input.holdId);
    }
  }

  const [updated] = await tx
    .update(holds)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(holds.id, input.holdId),
        // Only allow cancellation of active holds.
        inArray(holds.status, ["queued", "ready"]),
      ),
    )
    .returning({ id: holds.id, bookId: holds.bookId, memberId: holds.memberId });

  if (!updated) {
    throw new HoldNotFoundError(input.holdId);
  }

  await writeAuditLog(tx, ctx, {
    action: "hold.cancelled",
    subjectType: "hold",
    subjectId: input.holdId,
    afterJson: { bookId: updated.bookId, memberId: updated.memberId },
  });
}
