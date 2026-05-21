/**
 * borrowBook — creates a new loan (REQ-03-01).
 *
 * Concurrency safety: SELECT … FOR UPDATE on the book row serialises concurrent
 * borrow attempts. The second requester blocks until the first commits, then
 * sees the active loan and receives BookAlreadyBorrowedError.
 *
 * TODO (Spec 07): emit('loan.checked_out', { loanId, tenantId }) after commit.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { books } from "@/lib/db/schema/books";
import { loans } from "@/lib/db/schema/loans";
import type { LoanRow } from "@/lib/db/schema/loans";
import { members } from "@/lib/db/schema/members";
import { tenants } from "@/lib/db/schema/tenants";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, isNull } from "drizzle-orm";
import { BookAlreadyBorrowedError, BookWithdrawnError, MemberNotActiveError } from "./errors";
import { computeDueAt } from "./loan-policy";

export interface BorrowBookResult {
  loan: LoanRow;
}

/**
 * Opens a loan for (bookId, memberId).
 *
 * @throws BookWithdrawnError        if the book is soft-deleted.
 * @throws MemberNotActiveError      if the member's status is not 'active'.
 * @throws BookAlreadyBorrowedError  if the book already has an active loan.
 */
export async function borrowBook(
  tx: TxClient,
  ctx: TenantCtx,
  input: { bookId: string; memberId: string },
): Promise<BorrowBookResult> {
  // 1. Lock the book row to serialise concurrent borrows (FOR UPDATE).
  const [book] = await tx.select().from(books).where(eq(books.id, input.bookId)).for("update");

  if (!book) {
    // Book not found at all — treat as withdrawn (404 vs 410 distinction not worth
    // separate error here; the RLS policy would hide a cross-tenant book anyway).
    throw new BookWithdrawnError(input.bookId);
  }

  if (book.deletedAt !== null) {
    throw new BookWithdrawnError(input.bookId);
  }

  // 2. Verify member is active.
  const [member] = await tx.select().from(members).where(eq(members.id, input.memberId));

  if (!member || member.status !== "active") {
    throw new MemberNotActiveError(input.memberId);
  }

  // 3. Check for existing active loan.
  const [existingLoan] = await tx
    .select({ id: loans.id })
    .from(loans)
    .where(and(eq(loans.bookId, input.bookId), isNull(loans.returnedAt)))
    .limit(1);

  if (existingLoan) {
    throw new BookAlreadyBorrowedError(input.bookId);
  }

  // 4. Read tenant policy for due date computation.
  const [tenant] = await tx
    .select({ loanDurationDays: tenants.loanDurationDays })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId));

  const loanDurationDays = tenant?.loanDurationDays ?? 14;

  // 5. Compute due date.
  const checkedOutAt = new Date();
  const dueAt = computeDueAt(checkedOutAt, loanDurationDays);

  // 6. Insert the loan row.
  const [loan] = await tx
    .insert(loans)
    .values({
      tenantId: ctx.tenantId,
      bookId: input.bookId,
      memberId: input.memberId,
      librarianId: ctx.userId,
      checkedOutAt,
      dueAt,
      renewedCount: 0,
    })
    .returning();

  if (!loan) throw new Error("borrowBook: insert returned no row — unexpected DB state");

  // 7. Audit log.
  await writeAuditLog(tx, ctx, {
    action: "loan.borrowed",
    subjectType: "loan",
    subjectId: loan.id,
    afterJson: {
      bookId: input.bookId,
      memberId: input.memberId,
      dueAt: dueAt.toISOString(),
    },
  });

  // TODO (Spec 07): emit('loan.checked_out', { loanId: loan.id, tenantId: ctx.tenantId })

  return { loan };
}
