/**
 * createBook domain function — inserts one books row and one audit_log row
 * atomically inside the caller's transaction (REQ-02-03).
 *
 * Emitting `book.created` for the search-indexer is deferred to Spec 05.
 * TODO (Spec 05): emit a `book.created` domain event after the insert so the
 * embedding + tsvector worker can index the new record.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import type { BookId } from "@/lib/db/schema/_shared";
import { books } from "@/lib/db/schema/books";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import type { CreateBookInput } from "./schemas";

export interface CreateBookResult {
  id: BookId;
}

/**
 * Inserts a validated book record and writes an audit log row atomically.
 *
 * @param tx    - Active tenant transaction.
 * @param ctx   - Tenant context (provides tenantId + userId for audit).
 * @param input - Validated CreateBookInput (from the Server Action's Zod parse).
 * @returns     The new book's UUID.
 */
export async function createBook(
  tx: TxClient,
  ctx: TenantCtx,
  input: CreateBookInput,
): Promise<CreateBookResult> {
  const [row] = await tx
    .insert(books)
    .values({
      tenantId: ctx.tenantId,
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
    })
    .returning({ id: books.id });

  // row is guaranteed by the .returning() + insert; TypeScript needs the guard
  if (!row) throw new Error("createBook: insert returned no row — unexpected DB state");

  await writeAuditLog(tx, ctx, {
    action: "book.created",
    subjectType: "book",
    subjectId: row.id,
    afterJson: input,
  });

  // TODO (Spec 05): emit book.created domain event for search indexer.

  return { id: row.id as BookId };
}
