/**
 * renewLoan — extends a loan's due date (REQ-03-05).
 *
 * Guards:
 *   1. Loan must be active (returned_at IS NULL).
 *   2. Optimistic concurrency: expectedUpdatedAt must match the stored updatedAt.
 *   3. Renewal count must be < tenant.max_renewals.
 *   4. No queued/ready hold may exist for the book.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { books } from "@/lib/db/schema/books";
import { holds } from "@/lib/db/schema/holds";
import { loans } from "@/lib/db/schema/loans";
import type { LoanRow } from "@/lib/db/schema/loans";
import { tenants } from "@/lib/db/schema/tenants";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { OptimisticConcurrencyError } from "@/lib/domain/books/errors";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  LoanAlreadyReturnedError,
  LoanNotFoundError,
  RenewalBlockedByHoldError,
  RenewalLimitReachedError,
} from "./errors";
import { computeDueAt } from "./loan-policy";

export interface RenewLoanResult {
  loan: LoanRow;
}

/**
 * Renews an active loan, extending its due date by loan_duration_days.
 *
 * @throws LoanNotFoundError          if the loan does not exist.
 * @throws LoanAlreadyReturnedError   if the loan is already closed.
 * @throws OptimisticConcurrencyError if expectedUpdatedAt does not match.
 * @throws RenewalLimitReachedError   if renewed_count >= max_renewals.
 * @throws RenewalBlockedByHoldError  if a queued/ready hold exists.
 */
export async function renewLoan(
  tx: TxClient,
  ctx: TenantCtx,
  input: { loanId: string; expectedUpdatedAt: string },
): Promise<RenewLoanResult> {
  // 1. Read current loan state.
  const [loan] = await tx.select().from(loans).where(eq(loans.id, input.loanId));

  if (!loan) {
    throw new LoanNotFoundError(input.loanId);
  }

  if (loan.returnedAt !== null) {
    throw new LoanAlreadyReturnedError(input.loanId);
  }

  // 2. Optimistic concurrency check.
  if (loan.updatedAt.toISOString() !== input.expectedUpdatedAt) {
    throw new OptimisticConcurrencyError(input.loanId);
  }

  // 3. Read tenant policy.
  const [tenant] = await tx
    .select({
      maxRenewals: tenants.maxRenewals,
      loanDurationDays: tenants.loanDurationDays,
    })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId));

  const maxRenewals = tenant?.maxRenewals ?? 2;
  const loanDurationDays = tenant?.loanDurationDays ?? 14;

  // 4. Renewal limit check.
  if (loan.renewedCount >= maxRenewals) {
    throw new RenewalLimitReachedError(input.loanId, maxRenewals);
  }

  // 5. Lock the book row — same serialization point used by borrowBook / placeHold.
  // This prevents a concurrent placeHold from inserting a hold between our conflict
  // check (step 6) and the UPDATE (step 7), which would allow renewal to succeed
  // even though a member is now waiting (TOCTOU fix for H-3).
  await tx.select({ id: books.id }).from(books).where(eq(books.id, loan.bookId)).for("update");

  // 6. Hold conflict check (after acquiring the book lock).
  // Exclude the borrower's own member_id: a member who holds both an active loan
  // AND a hold on the same book should not be blocked from renewing by their own hold
  // (M-2 fix). The partial unique index allows this edge case; defense-in-depth is
  // the placeHold guard (not yet added), but renewal must not punish the borrower.
  const [blockingHold] = await tx
    .select({ id: holds.id })
    .from(holds)
    .where(
      and(
        eq(holds.bookId, loan.bookId),
        inArray(holds.status, ["queued", "ready"]),
        ne(holds.memberId, loan.memberId),
      ),
    )
    .limit(1);

  if (blockingHold) {
    throw new RenewalBlockedByHoldError(loan.bookId);
  }

  // 6. Extend due date.
  const prevDueAt = loan.dueAt;
  const newDueAt = computeDueAt(prevDueAt, loanDurationDays);
  const now = new Date();

  const [updated] = await tx
    .update(loans)
    .set({
      dueAt: newDueAt,
      renewedCount: loan.renewedCount + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(loans.id, input.loanId),
        isNull(loans.returnedAt),
        // Re-check updatedAt at write time — concurrent renew protection.
        eq(loans.updatedAt, loan.updatedAt),
      ),
    )
    .returning();

  if (!updated) {
    // Another concurrent renewal won the race.
    throw new OptimisticConcurrencyError(input.loanId);
  }

  await writeAuditLog(tx, ctx, {
    action: "loan.renewed",
    subjectType: "loan",
    subjectId: input.loanId,
    afterJson: {
      prevDueAt: prevDueAt.toISOString(),
      newDueAt: newDueAt.toISOString(),
      renewedCount: loan.renewedCount + 1,
    },
  });

  return { loan: updated };
}
