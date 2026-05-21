/**
 * hasActiveLoan — checks whether a book has any active (unreturned) loan.
 *
 * STUB: Spec 03 (Circulation) hasn't built the `loans` table yet.
 * This function always returns false so the soft-delete flow doesn't block.
 *
 * FOLLOW-UP (Spec 03): Replace this stub with a real Drizzle query:
 *
 *   import { and, eq, isNull } from "drizzle-orm";
 *   import { loans } from "@/lib/db/schema/loans";
 *
 *   const rows = await tx
 *     .select({ id: loans.id })
 *     .from(loans)
 *     .where(and(eq(loans.bookId, bookId), isNull(loans.returnedAt)))
 *     .limit(1);
 *   return rows.length > 0;
 *
 * The loans table RLS policy will enforce tenant isolation automatically.
 */

import type { TxClient } from "@/lib/db/with-tenant-tx";

/**
 * Returns true if the book has at least one active (not returned) loan.
 *
 * @param _tx - Transaction client (unused until Spec 03 wires the loans table).
 * @param _bookId - The book UUID to check.
 * @returns Always false in Run A (Spec 02 stub).
 */
export async function hasActiveLoan(_tx: TxClient, _bookId: string): Promise<false> {
  // STUB: always returns false; Spec 03 replaces with real query.
  return false;
}
