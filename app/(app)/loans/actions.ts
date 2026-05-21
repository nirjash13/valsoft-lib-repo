/**
 * Loan management Server Actions — the command bus for Spec 03 circulation.
 *
 * Pattern: actionClient.schema(…).metadata({ permission }).action(async ({ parsedInput, ctx }) =>
 *   withTenantTx(ctx.tenantCtx, async (tx, txCtx) => domainFn(tx, txCtx, parsedInput))
 * )
 *
 * Cache invalidation: every mutation calls revalidateTag for loans, holds, and books
 * (book availability changes on borrow/return).
 */

"use server";

import { actionClient } from "@/lib/auth/safe-action";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { borrowBook } from "@/lib/domain/loans/borrow-book";
import { renewLoan } from "@/lib/domain/loans/renew-loan";
import { returnBook } from "@/lib/domain/loans/return-book";
import { BorrowBookSchema, RenewLoanSchema, ReturnBookSchema } from "@/lib/domain/loans/schemas";
import { revalidateTag } from "next/cache";

// ---------------------------------------------------------------------------
// borrowBookAction — loan:create
// ---------------------------------------------------------------------------

/**
 * Creates a new loan for (bookId, memberId).
 * Refused if book is withdrawn, member is not active, or book is already borrowed.
 *
 * @permission loan:create
 */
export const borrowBookAction = actionClient
  .schema(BorrowBookSchema)
  .metadata({ permission: "loan:create" })
  .action(async ({ parsedInput, ctx }) => {
    const result = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      return borrowBook(tx, txCtx, parsedInput);
    });

    const tenantId = ctx.tenantCtx.tenantId;
    revalidateTag(`tenant:${tenantId}:loans`, "default");
    revalidateTag(`tenant:${tenantId}:books`, "default");

    return { loanId: result.loan.id };
  });

// ---------------------------------------------------------------------------
// returnBookAction — loan:update
// ---------------------------------------------------------------------------

/**
 * Closes an active loan (marks returned_at).
 * Refused if loan is not found or already returned.
 * On success, promotes the next queued hold for the book.
 *
 * @permission loan:update
 */
export const returnBookAction = actionClient
  .schema(ReturnBookSchema)
  .metadata({ permission: "loan:update" })
  .action(async ({ parsedInput, ctx }) => {
    const result = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      return returnBook(tx, txCtx, parsedInput);
    });

    const tenantId = ctx.tenantCtx.tenantId;
    revalidateTag(`tenant:${tenantId}:loans`, "default");
    revalidateTag(`tenant:${tenantId}:holds`, "default");
    revalidateTag(`tenant:${tenantId}:books`, "default");

    return { loanId: result.loan.id, returnedAt: result.loan.returnedAt?.toISOString() };
  });

// ---------------------------------------------------------------------------
// renewLoanAction — loan:update
// ---------------------------------------------------------------------------

/**
 * Renews a loan, extending its due date by tenant.loan_duration_days.
 * Refused if: renewal limit reached, a hold is blocking, or optimistic concurrency fails.
 *
 * @permission loan:update
 */
export const renewLoanAction = actionClient
  .schema(RenewLoanSchema)
  .metadata({ permission: "loan:update" })
  .action(async ({ parsedInput, ctx }) => {
    const result = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      return renewLoan(tx, txCtx, parsedInput);
    });

    const tenantId = ctx.tenantCtx.tenantId;
    revalidateTag(`tenant:${tenantId}:loans`, "default");

    return {
      loanId: result.loan.id,
      dueAt: result.loan.dueAt.toISOString(),
      renewedCount: result.loan.renewedCount,
    };
  });
