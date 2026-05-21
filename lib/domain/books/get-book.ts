/**
 * getBook — fetch a single book by ID within the current tenant.
 *
 * RLS ensures the query only sees the current tenant's rows. Soft-deleted
 * rows are returned if they exist (caller decides to show/hide them);
 * the Server Action layer hides them per REQ-02-06.
 */

import { books } from "@/lib/db/schema/books";
import type { BookRow } from "@/lib/db/schema/books";
import type { TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, isNull } from "drizzle-orm";
import { BookNotFoundError } from "./errors";

/**
 * Returns the book row or throws BookNotFoundError.
 *
 * @param includeDeleted - When true, soft-deleted books are returned.
 *                         Default false (hides deleted rows).
 */
export async function getBook(
  tx: TxClient,
  bookId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<BookRow> {
  const { includeDeleted = false } = options;

  const conditions = [eq(books.id, bookId)];
  if (!includeDeleted) {
    conditions.push(isNull(books.deletedAt));
  }

  const rows = await tx
    .select()
    .from(books)
    .where(and(...conditions))
    .limit(1);

  if (rows.length === 0) throw new BookNotFoundError(bookId);
  // biome-ignore lint/style/noNonNullAssertion: .limit(1) + length check guarantees the row
  return rows[0]!;
}
