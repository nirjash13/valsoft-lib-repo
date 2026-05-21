/**
 * updateBook — updates a book with optimistic concurrency check (REQ-02-04).
 *
 * The optimistic concurrency check uses `updated_at`: the caller passes the
 * `updated_at` value they last saw; the UPDATE includes `WHERE updated_at = expected`.
 * If another writer has already updated the row, `rowCount = 0` → OptimisticConcurrencyError.
 *
 * Emitting `book.updated` for the search-indexer is deferred to Spec 05.
 * TODO (Spec 05): emit a `book.updated` domain event after the update.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import type { BookId } from "@/lib/db/schema/_shared";
import { books } from "@/lib/db/schema/books";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, isNull } from "drizzle-orm";
import { OptimisticConcurrencyError } from "./errors";
import { getBook } from "./get-book";
import type { UpdateBookInput } from "./schemas";

export interface UpdateBookResult {
  id: BookId;
}

/**
 * Updates a book's fields with optimistic concurrency protection.
 *
 * @param tx    - Active tenant transaction.
 * @param ctx   - Tenant context (for audit log).
 * @param input - Validated UpdateBookInput including id and expectedUpdatedAt.
 * @throws BookNotFoundError if the book doesn't exist or is soft-deleted.
 * @throws OptimisticConcurrencyError if updated_at has changed (concurrent edit).
 */
export async function updateBook(
  tx: TxClient,
  ctx: TenantCtx,
  input: UpdateBookInput,
): Promise<UpdateBookResult> {
  // Read current state for the before-snapshot in audit log.
  // This also throws BookNotFoundError if the book doesn't exist.
  const before = await getBook(tx, input.id);

  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  const now = new Date();

  // Optimistic concurrency: UPDATE only if updated_at hasn't changed.
  const result = await tx
    .update(books)
    .set({
      isbn13: input.isbn13 ?? null,
      title: input.title,
      authors: input.authors,
      year: input.year ?? null,
      publisher: input.publisher ?? null,
      pageCount: input.pageCount ?? null,
      subjects: input.subjects ?? null,
      language: input.language ?? null,
      coverUrl: input.coverUrl ?? null,
      description: input.description ?? null,
      customFields: input.customFields ?? null,
      updatedAt: now,
    })
    .where(
      and(eq(books.id, input.id), eq(books.updatedAt, expectedUpdatedAt), isNull(books.deletedAt)),
    )
    .returning({ id: books.id });

  if (result.length === 0) {
    // Either the book was deleted concurrently (handled by getBook above) or
    // updated_at changed → concurrency conflict.
    throw new OptimisticConcurrencyError(input.id);
  }

  await writeAuditLog(tx, ctx, {
    action: "book.updated",
    subjectType: "book",
    subjectId: input.id,
    beforeJson: before,
    afterJson: input,
  });

  // TODO (Spec 05): emit book.updated domain event for search indexer.

  return { id: input.id as BookId };
}
