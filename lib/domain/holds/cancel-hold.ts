/**
 * cancelHold — cancels a queued hold (librarian or hold owner).
 *
 * Authorization notes:
 *   - A member may cancel their own hold (CASL: hold:delete on own hold).
 *   - A librarian may cancel any hold in the tenant (hold:delete).
 *   - Tenant admin may cancel any hold (hold:manage).
 * The CASL gate is enforced at the Server Action layer via metadata.permission.
 * Domain function receives the loanId and trusts that the gate already ran.
 *
 * Only 'queued' holds can be cancelled. 'ready' holds should be handled by
 * the return / expire worker path; attempting to cancel a 'ready' hold also
 * succeeds here (pragmatic: the librarian can cancel a ready hold for the member).
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { holds } from "@/lib/db/schema/holds";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, inArray } from "drizzle-orm";
import { HoldNotFoundError } from "./errors";

/**
 * Cancels an active (queued or ready) hold.
 *
 * @throws HoldNotFoundError if the hold does not exist or is already expired/cancelled.
 */
export async function cancelHold(
  tx: TxClient,
  ctx: TenantCtx,
  input: { holdId: string },
): Promise<void> {
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
