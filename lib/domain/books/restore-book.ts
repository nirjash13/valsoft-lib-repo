/**
 * restoreBook — clears deleted_at on a soft-deleted book (REQ-02-07).
 *
 * Only restores within the 30-day retention window. After 30 days, the
 * daily purge worker (Spec 08) anonymizes the record — at that point
 * restoration is blocked.
 *
 * Spec 05 REQ-05-03: re-embeds the book after restoration in case the embedding
 * row was deleted or is stale. Skipped silently when AI_SEARCH_ENABLED is false.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import type { BookId } from "@/lib/db/schema/_shared";
import { books } from "@/lib/db/schema/books";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { embedBook } from "@/lib/domain/search/embed-book";
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

  // Spec 05 REQ-05-03: re-embed the restored book.
  // Non-fatal: a transient AI Gateway outage must not block book restoration.
  // A backfill Workflow (REQ-05-03 async indexing) is the follow-up path.
  try {
    await embedBook(tx, {
      tenantId: ctx.tenantId as import("@/lib/db/schema/_shared").TenantId,
      bookId: bookId as BookId,
    });
  } catch (err) {
    console.warn(`[restoreBook] embedding skipped — tenant=${ctx.tenantId} book=${bookId}`, err);
  }
}
