/**
 * hasActiveLoan — checks whether a book has any active (unreturned) loan.
 *
 * Used by:
 *   - softDeleteBook (lib/domain/books/soft-delete-book.ts) — refuses delete if active.
 *   - placeHold (lib/domain/holds/place-hold.ts) — hold only valid when book is borrowed.
 *   - borrowBook (lib/domain/loans/borrow-book.ts) — double-borrow guard.
 *
 * The loans table RLS policy enforces tenant isolation automatically via
 * assert_tenant() so there is no need to pass tenantId explicitly.
 */

import { loans } from "@/lib/db/schema/loans";
import type { TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Returns true if the book has at least one active (not returned) loan.
 *
 * @param tx     - Active tenant transaction (RLS enforces tenant isolation).
 * @param bookId - The book UUID to check.
 */
export async function hasActiveLoan(tx: TxClient, bookId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: loans.id })
    .from(loans)
    .where(and(eq(loans.bookId, bookId), isNull(loans.returnedAt)))
    .limit(1);

  return rows.length > 0;
}
