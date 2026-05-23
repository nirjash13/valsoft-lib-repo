/**
 * listLoansByMember — returns active loans for a member with enriched status flags (REQ-03-07).
 */

import { books } from "@/lib/db/schema/books";
import { holds } from "@/lib/db/schema/holds";
import { loans } from "@/lib/db/schema/loans";
import type { LoanRow } from "@/lib/db/schema/loans";
import { tenants } from "@/lib/db/schema/tenants";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { canRenew } from "./loan-policy";

export interface ActiveLoanView extends LoanRow {
  canRenew: boolean;
  isOverdue: boolean;
  bookTitle: string;
  bookAuthors: ReadonlyArray<string>;
}

/**
 * Returns all active (unreturned) loans for a member, ordered by due date ascending.
 * Enriches each loan with canRenew, isOverdue flags, and the book title/authors
 * (REQ-03-07, REQ-03-08) so the UI can render names instead of UUIDs.
 */
export async function listLoansByMember(
  tx: TxClient,
  ctx: TenantCtx,
  memberId: string,
): Promise<ReadonlyArray<ActiveLoanView>> {
  // Read tenant policy once.
  const [tenant] = await tx
    .select({ maxRenewals: tenants.maxRenewals })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId));

  const maxRenewals = tenant?.maxRenewals ?? 2;

  // Fetch active loans joined with book title/authors.
  const rows = await tx
    .select({
      loan: loans,
      bookTitle: books.title,
      bookAuthors: books.authors,
    })
    .from(loans)
    .innerJoin(books, eq(books.id, loans.bookId))
    .where(and(eq(loans.memberId, memberId), isNull(loans.returnedAt)))
    .orderBy(asc(loans.dueAt));

  if (rows.length === 0) return [];

  // Fetch books with any queued/ready hold (to check renewal eligibility).
  const bookIds = rows.map((r) => r.loan.bookId);
  const blockedBookRows = await tx
    .selectDistinct({ bookId: holds.bookId })
    .from(holds)
    .where(and(inArray(holds.bookId, bookIds), inArray(holds.status, ["queued", "ready"])));

  const blockedBookIdSet = new Set(blockedBookRows.map((r) => r.bookId));
  const now = new Date();

  return rows.map((row) => ({
    ...row.loan,
    canRenew: canRenew({
      renewedCount: row.loan.renewedCount,
      maxRenewals,
      hasQueuedHold: blockedBookIdSet.has(row.loan.bookId),
    }),
    isOverdue: row.loan.dueAt < now,
    bookTitle: row.bookTitle,
    bookAuthors: row.bookAuthors ?? [],
  }));
}
