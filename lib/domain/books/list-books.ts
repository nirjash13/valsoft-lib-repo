/**
 * listBooks — paginated book listing for the current tenant (REQ-02-06).
 *
 * Defaults to filtering out soft-deleted books (deleted_at IS NULL).
 * Explicitly pass `includeDeleted: true` for the Trash admin view.
 */

import { books } from "@/lib/db/schema/books";
import type { BookRow } from "@/lib/db/schema/books";
import type { TxClient } from "@/lib/db/with-tenant-tx";
import { and, asc, desc, isNotNull, isNull, like, or } from "drizzle-orm";
import type { ListBooksFilter } from "./schemas";

/**
 * Returns a page of books for the current tenant.
 *
 * RLS ensures only the bound tenant's rows are visible. The filter is applied
 * on top of the RLS restriction.
 *
 * @param tx     - Active tenant transaction.
 * @param filter - Pagination + search + soft-delete options.
 * @returns      Read-only array of book rows.
 */
export async function listBooks(
  tx: TxClient,
  filter: ListBooksFilter,
): Promise<ReadonlyArray<BookRow>> {
  const { query, includeDeleted, limit, offset } = filter;

  const conditions = [];

  // Soft-delete filter (REQ-02-06)
  if (!includeDeleted) {
    conditions.push(isNull(books.deletedAt));
  } else {
    // Trash view: show only deleted books
    conditions.push(isNotNull(books.deletedAt));
  }

  // Simple title/isbn text search (full-text search is Spec 05)
  if (query && query.length > 0) {
    const pattern = `%${query}%`;
    conditions.push(or(like(books.title, pattern), like(books.isbn13, pattern)));
  }

  const rows = await tx
    .select()
    .from(books)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(includeDeleted ? desc(books.deletedAt) : asc(books.title))
    .limit(limit)
    .offset(offset);

  return rows;
}
