/**
 * createBook domain function — inserts one books row, one audit_log row,
 * and triggers embedding indexing, all atomically inside the caller's transaction
 * (REQ-02-03, REQ-05-03).
 *
 * Embedding: called synchronously after INSERT. Adds ~200ms when AI_SEARCH_ENABLED=true
 * (budget check + API call). Acceptable for interactive book creation. A background
 * Workflow for batch backfill is a Spec 05 follow-up (flagged IT-05-2).
 *
 * Note: the tsv GENERATED column is maintained by Postgres automatically —
 * no application-layer step is needed for full-text indexing.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import type { BookId } from "@/lib/db/schema/_shared";
import { books } from "@/lib/db/schema/books";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { embedBook } from "@/lib/domain/search/embed-book";
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

  // Spec 05 REQ-05-03: embed the new book for semantic search.
  // Non-fatal: a transient AI Gateway outage must not block book creation.
  // The book is still lexically searchable. A backfill Workflow (REQ-05-03 async
  // indexing) is the follow-up path for books that land here without an embedding.
  try {
    await embedBook(tx, {
      tenantId: ctx.tenantId as import("@/lib/db/schema/_shared").TenantId,
      bookId: row.id as BookId,
    });
  } catch (err) {
    console.warn(`[createBook] embedding skipped — tenant=${ctx.tenantId} book=${row.id}`, err);
  }

  return { id: row.id as BookId };
}
