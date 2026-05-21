/**
 * returnBook — closes an active loan (REQ-03-02).
 *
 * After marking the loan returned, calls promoteNextHold so the head of the
 * hold queue (if any) gets notified immediately.
 *
 * TODO (Spec 07): emit('loan.returned', { loanId, tenantId }) after commit.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { loans } from "@/lib/db/schema/loans";
import type { LoanRow } from "@/lib/db/schema/loans";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { promoteNextHold } from "@/lib/domain/holds/promote-next-hold";
import { and, eq, isNull } from "drizzle-orm";
import { LoanAlreadyReturnedError, LoanNotFoundError } from "./errors";

export interface ReturnBookResult {
  loan: LoanRow;
}

/**
 * Marks a loan as returned and promotes the next queued hold.
 *
 * @throws LoanNotFoundError        if the loanId does not exist.
 * @throws LoanAlreadyReturnedError if the loan was already returned.
 */
export async function returnBook(
  tx: TxClient,
  ctx: TenantCtx,
  input: { loanId: string },
): Promise<ReturnBookResult> {
  const returnedAt = new Date();

  // Attempt to close the active loan atomically.
  const [updated] = await tx
    .update(loans)
    .set({ returnedAt, updatedAt: returnedAt })
    .where(and(eq(loans.id, input.loanId), isNull(loans.returnedAt)))
    .returning();

  if (!updated) {
    // 0 rows updated — distinguish "not found" from "already returned".
    const [existing] = await tx
      .select({ id: loans.id, returnedAt: loans.returnedAt })
      .from(loans)
      .where(eq(loans.id, input.loanId));

    if (!existing) {
      throw new LoanNotFoundError(input.loanId);
    }
    throw new LoanAlreadyReturnedError(input.loanId);
  }

  await writeAuditLog(tx, ctx, {
    action: "loan.returned",
    subjectType: "loan",
    subjectId: input.loanId,
    afterJson: { returnedAt: returnedAt.toISOString() },
  });

  // Promote the next queued hold for this book (REQ-03-03).
  await promoteNextHold(tx, ctx, updated.bookId);

  // TODO (Spec 07): emit('loan.returned', { loanId: input.loanId, tenantId: ctx.tenantId })

  return { loan: updated };
}
