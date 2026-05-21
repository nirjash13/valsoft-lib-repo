/**
 * softDeleteBook — sets books.deleted_at = NOW() (REQ-02-05).
 *
 * Refuses if the book has an active (unreturned) loan.
 * The hasActiveLoan check is a stub in Spec 02 — returns false always.
 * FOLLOW-UP (Spec 03): hasActiveLoan stub replaced with real loans table query.
 *
 * Daily purge worker (REQ-02-08) — deferred to Spec 08.
 * TODO (Spec 08): the daily purge worker must call a separate anonymize() function
 * for books where deleted_at < now() - interval '30 days', clearing cover_url /
 * description / custom_fields while preserving title / authors for loan history.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { books } from "@/lib/db/schema/books";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { hasActiveLoan } from "@/lib/domain/loans/has-active-loan";
import { and, eq, isNull } from "drizzle-orm";
import { BookHasActiveLoanError, BookNotFoundError } from "./errors";
import { getBook } from "./get-book";

/**
 * Soft-deletes a book by setting deleted_at = now().
 *
 * @throws BookNotFoundError       if the book doesn't exist or is already deleted.
 * @throws BookHasActiveLoanError  if the book has an active loan (Spec 03 stub: never throws).
 */
export async function softDeleteBook(tx: TxClient, ctx: TenantCtx, bookId: string): Promise<void> {
  // Verify the book exists and is not already deleted
  const before = await getBook(tx, bookId);

  // REQ-02-05: refuse if active loan exists (stub returns false in Spec 02)
  const active = await hasActiveLoan(tx, bookId);
  if (active) {
    throw new BookHasActiveLoanError(bookId);
  }

  const deletedAt = new Date();
  const result = await tx
    .update(books)
    .set({ deletedAt })
    .where(and(eq(books.id, bookId), isNull(books.deletedAt)))
    .returning({ id: books.id });

  if (result.length === 0) {
    throw new BookNotFoundError(bookId);
  }

  await writeAuditLog(tx, ctx, {
    action: "book.soft_deleted",
    subjectType: "book",
    subjectId: bookId,
    beforeJson: before,
    afterJson: { deletedAt },
  });

  // TODO (Spec 08): the daily purge worker anonymizes books older than 30 days.
}
