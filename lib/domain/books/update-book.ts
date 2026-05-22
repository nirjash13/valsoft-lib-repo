/**
 * updateBook — updates a book with optimistic concurrency check (REQ-02-04).
 *
 * The optimistic concurrency check uses `updated_at`: the caller passes the
 * `updated_at` value they last saw; the UPDATE includes `WHERE updated_at = expected`.
 * If another writer has already updated the row, `rowCount = 0` → OptimisticConcurrencyError.
 *
 * Spec 05 REQ-05-03: re-embeds the book when any searchable field changes.
 * The Postgres GENERATED tsv column is updated automatically by the DB engine.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import type { BookId } from "@/lib/db/schema/_shared";
import { books } from "@/lib/db/schema/books";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { embedBook } from "@/lib/domain/search/embed-book";
import { and, eq, isNull } from "drizzle-orm";
import { OptimisticConcurrencyError } from "./errors";
import { getBook } from "./get-book";
import type { UpdateBookInput } from "./schemas";

export interface UpdateBookResult {
  id: BookId;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if any field that contributes to the tsvector/embedding has changed.
 * Used to decide whether to trigger a re-embed after an update.
 */
function searchableFieldsChanged(
  before: {
    title: string;
    authors: string[];
    subjects: string[] | null;
    description: string | null | undefined;
  },
  after: UpdateBookInput,
): boolean {
  if (before.title !== after.title) return true;
  if (JSON.stringify(before.authors) !== JSON.stringify(after.authors)) return true;
  if (JSON.stringify(before.subjects ?? null) !== JSON.stringify(after.subjects ?? null))
    return true;
  if ((before.description ?? null) !== (after.description ?? null)) return true;
  return false;
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

  // Spec 05 REQ-05-03: re-embed if any searchable field changed.
  // Non-fatal: a transient AI Gateway outage must not block book updates.
  // A backfill Workflow (REQ-05-03 async indexing) is the follow-up path.
  if (searchableFieldsChanged(before, input)) {
    try {
      await embedBook(tx, {
        tenantId: ctx.tenantId as import("@/lib/db/schema/_shared").TenantId,
        bookId: input.id as BookId,
      });
    } catch (err) {
      console.warn(`[updateBook] embedding skipped — tenant=${ctx.tenantId} book=${input.id}`, err);
    }
  }

  return { id: input.id as BookId };
}
