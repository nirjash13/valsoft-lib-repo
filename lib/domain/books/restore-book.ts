/**
 * restoreBook — clears deleted_at on a soft-deleted book (REQ-02-07).
 *
 * Only restores within the 30-day retention window. After 30 days, the
 * daily purge worker (Spec 08) anonymizes the record — at that point
 * restoration is blocked.
 *
 * Emitting `book.updated` for the search-indexer is deferred to Spec 05.
 * TODO (Spec 05): emit a `book.updated` domain event after restore.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { books } from "@/lib/db/schema/books";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { BookNotFoundError } from "./errors";

const RETENTION_DAYS = 30;

/**
 * Restores a soft-deleted book within the 30-day retention window.
 *
 * @throws BookNotFoundError if the book doesn't exist, is active, or is past
 *         the 30-day retention window.
 */
export async function restoreBook(tx: TxClient, ctx: TenantCtx, bookId: string): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Restore only if: exists AND deleted_at IS NOT NULL AND deleted_at >= cutoff
  const result = await tx
    .update(books)
    .set({ deletedAt: null })
    .where(and(eq(books.id, bookId), isNotNull(books.deletedAt), gte(books.deletedAt, cutoff)))
    .returning({ id: books.id });

  if (result.length === 0) {
    // Either: not found, not deleted, or past retention window
    throw new BookNotFoundError(bookId);
  }

  await writeAuditLog(tx, ctx, {
    action: "book.restored",
    subjectType: "book",
    subjectId: bookId,
  });

  // TODO (Spec 05): emit book.updated domain event for search indexer.
}
