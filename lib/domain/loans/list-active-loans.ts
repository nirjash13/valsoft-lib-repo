/**
 * listActiveLoans — librarian view of all active loans (REQ-03-08, REQ-03-10).
 *
 * Supports pagination and optional overdue-only filter.
 */

import { books } from "@/lib/db/schema/books";
import { loans } from "@/lib/db/schema/loans";
import type { LoanRow } from "@/lib/db/schema/loans";
import { members } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, asc, eq, isNull, lt } from "drizzle-orm";

export interface ListActiveLoansOptions {
  overdueOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ActiveLoanItem extends LoanRow {
  isOverdue: boolean;
  bookTitle: string;
  bookAuthors: ReadonlyArray<string>;
  memberDisplayName: string;
  memberEmail: string;
}

/**
 * Returns paginated active loans for the current tenant, joined with book and
 * member rows so the table can render human-readable titles and names instead
 * of raw UUIDs.
 *
 * @param overdueOnly - If true, only return loans where due_at < NOW().
 * @param limit       - Page size (default 50, max 200).
 * @param offset      - Pagination offset (default 0).
 */
export async function listActiveLoans(
  tx: TxClient,
  _ctx: TenantCtx,
  options: ListActiveLoansOptions = {},
): Promise<ReadonlyArray<ActiveLoanItem>> {
  const { overdueOnly = false, limit = 50, offset = 0 } = options;
  const now = new Date();

  const conditions = [isNull(loans.returnedAt)];
  if (overdueOnly) {
    conditions.push(lt(loans.dueAt, now));
  }

  const rows = await tx
    .select({
      loan: loans,
      bookTitle: books.title,
      bookAuthors: books.authors,
      memberDisplayName: members.displayName,
      memberEmail: members.email,
    })
    .from(loans)
    .innerJoin(books, eq(books.id, loans.bookId))
    .innerJoin(members, eq(members.id, loans.memberId))
    .where(and(...conditions))
    .orderBy(asc(loans.dueAt))
    .limit(Math.min(limit, 200))
    .offset(offset);

  return rows.map((row) => ({
    ...row.loan,
    isOverdue: row.loan.dueAt < now,
    bookTitle: row.bookTitle,
    bookAuthors: row.bookAuthors ?? [],
    memberDisplayName: row.memberDisplayName,
    memberEmail: row.memberEmail,
  }));
}
