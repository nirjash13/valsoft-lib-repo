/**
 * resolve-duplicate — domain helper for REQ-10-06 / US-05.
 *
 * Handles librarian merge/skip decisions for duplicate import rows.
 *
 * "merge": update the existing book with non-empty CSV fields from the import row,
 *          mark the row status='merged', write audit_log.
 * "skip":  mark the row status='skipped', leave the existing book unchanged, write audit_log.
 *
 * All writes run inside the caller's transaction (withTenantTx).
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { books } from "@/lib/db/schema/books";
import { importRows } from "@/lib/db/schema/import-rows";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, sql } from "drizzle-orm";

export type DuplicateChoice = "merge" | "skip";

export interface ResolveDuplicateInput {
  rowId: string;
  choice: DuplicateChoice;
}

export interface ResolveDuplicateResult {
  status: "merged" | "skipped";
}

export class DuplicateRowNotFoundError extends Error {
  constructor(rowId: string) {
    super(`Import row ${rowId} not found or is not in 'duplicate' status`);
  }
}

export class ExistingBookNotFoundError extends Error {
  constructor(bookId: string) {
    super(`Existing book ${bookId} not found in this tenant's catalog`);
  }
}

/**
 * Resolves a duplicate import row by merging or skipping.
 *
 * Must be called inside a withTenantTx callback — the caller owns the transaction.
 */
export async function resolveDuplicate(
  tx: TxClient,
  ctx: TenantCtx,
  input: ResolveDuplicateInput,
): Promise<ResolveDuplicateResult> {
  const { rowId, choice } = input;

  // 1. Fetch the duplicate row (RLS-scoped to this tenant)
  const [row] = await tx
    .select()
    .from(importRows)
    .where(and(eq(importRows.id, rowId), eq(importRows.status, "duplicate")))
    .limit(1);

  if (!row) {
    throw new DuplicateRowNotFoundError(rowId);
  }

  if (!row.existingBookId) {
    throw new DuplicateRowNotFoundError(rowId);
  }

  const existingBookId = row.existingBookId;

  if (choice === "skip") {
    await tx
      .update(importRows)
      .set({ status: "skipped", updatedAt: new Date() })
      .where(eq(importRows.id, rowId));

    await writeAuditLog(tx, ctx, {
      action: "import.duplicate.skipped",
      subjectType: "book",
      subjectId: existingBookId,
      afterJson: { rowId, existingBookId },
    });

    return { status: "skipped" };
  }

  // choice === "merge"
  // 2. Fetch the existing book to read its current state for the audit beforeJson
  const [existingBook] = await tx
    .select()
    .from(books)
    .where(and(eq(books.id, existingBookId), sql`${books.deletedAt} IS NULL`))
    .limit(1);

  if (!existingBook) {
    throw new ExistingBookNotFoundError(existingBookId);
  }

  // 3. Build the merge patch — only non-empty CSV fields overwrite the existing book
  const patch: Partial<typeof books.$inferInsert> = { updatedAt: new Date() };

  if (row.title && row.title.trim() !== "") {
    patch.title = row.title;
  }
  if (row.authors && row.authors.length > 0) {
    patch.authors = row.authors;
  }
  if (row.isbn13 && row.isbn13.trim() !== "") {
    patch.isbn13 = row.isbn13;
  }
  if (row.year !== null && row.year !== undefined) {
    patch.year = row.year;
  }
  if (row.publisher && row.publisher.trim() !== "") {
    patch.publisher = row.publisher;
  }
  if (row.pageCount !== null && row.pageCount !== undefined) {
    patch.pageCount = row.pageCount;
  }
  if (row.subjects && row.subjects.length > 0) {
    patch.subjects = row.subjects;
  }
  if (row.language && row.language.trim() !== "") {
    patch.language = row.language;
  }
  if (row.description && row.description.trim() !== "") {
    patch.description = row.description;
  }

  await tx.update(books).set(patch).where(eq(books.id, existingBookId));

  // 4. Mark the import row as merged
  await tx
    .update(importRows)
    .set({ status: "merged", updatedAt: new Date() })
    .where(eq(importRows.id, rowId));

  // 5. Write audit log inside the same transaction
  await writeAuditLog(tx, ctx, {
    action: "import.duplicate.merged",
    subjectType: "book",
    subjectId: existingBookId,
    beforeJson: existingBook,
    afterJson: { ...existingBook, ...patch },
  });

  return { status: "merged" };
}
