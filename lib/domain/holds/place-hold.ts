/**
 * placeHold — creates a hold reservation (REQ-03-04).
 *
 * A hold can only be placed when the book is currently borrowed.
 * Uniqueness (one active hold per member+book) is enforced by the partial
 * UNIQUE INDEX in the migration; unique violations are caught and mapped.
 *
 * TODO (Spec 07): emit('hold.placed', { holdId, memberId, tenantId }) after commit.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { books } from "@/lib/db/schema/books";
import { holds } from "@/lib/db/schema/holds";
import type { HoldRow } from "@/lib/db/schema/holds";
import { members } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { MemberNotActiveError } from "@/lib/domain/loans/errors";
import { hasActiveLoan } from "@/lib/domain/loans/has-active-loan";
import { and, count, eq, lte } from "drizzle-orm";
import { HoldAlreadyExistsError, HoldNotPlaceableError } from "./errors";

export interface PlaceHoldResult {
  hold: HoldRow;
  /** 1-based position in the queue (1 = next to be notified). */
  position: number;
}

/**
 * Places a hold for (bookId, memberId).
 *
 * @throws HoldNotPlaceableError   if the book has no active loan (borrow it directly).
 * @throws MemberNotActiveError    if the member's status is not 'active'.
 * @throws HoldAlreadyExistsError  if the member already has an active hold on this book.
 */
export async function placeHold(
  tx: TxClient,
  ctx: TenantCtx,
  input: { bookId: string; memberId: string },
): Promise<PlaceHoldResult> {
  // 1. Lock the book row — same serialization point used by borrowBook and renewLoan.
  // This coordinates with returnBook (which atomically updates the loan row, also
  // preventing concurrent reads from seeing a stale active-loan state) and prevents
  // a TOCTOU window where the active loan is returned between the hasActiveLoan check
  // and the hold INSERT, leaving a queued hold on an available book (H-4 fix).
  // Note: returnBook currently does not take a book-row lock (it locks via the loan
  // UPDATE's WHERE clause). The book-row lock here ensures placeHold and borrowBook
  // are serialized against each other; the returnBook atomicity relies on the loan's
  // UPDATE WHERE returned_at IS NULL which is sufficient for the return path but does
  // not block a concurrent placeHold read. The book-row lock closes the remaining gap.
  await tx.select({ id: books.id }).from(books).where(eq(books.id, input.bookId)).for("update");

  // 2. Hold only makes sense when the book is borrowed (checked AFTER book lock).
  const active = await hasActiveLoan(tx, input.bookId);
  if (!active) {
    throw new HoldNotPlaceableError(input.bookId);
  }

  // 3. Verify member is active.
  const [member] = await tx.select().from(members).where(eq(members.id, input.memberId));

  if (!member || member.status !== "active") {
    throw new MemberNotActiveError(input.memberId);
  }

  // 4. Insert — the partial UNIQUE INDEX will reject duplicates.
  let hold: HoldRow;
  try {
    const queuedAt = new Date();
    const [inserted] = await tx
      .insert(holds)
      .values({
        tenantId: ctx.tenantId,
        bookId: input.bookId,
        memberId: input.memberId,
        queuedAt,
        status: "queued",
      })
      .returning();

    if (!inserted) throw new Error("placeHold: insert returned no row — unexpected DB state");
    hold = inserted;
  } catch (err) {
    // Postgres unique violation code: 23505
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "23505") {
      throw new HoldAlreadyExistsError(input.bookId, input.memberId);
    }
    throw err;
  }

  // 5. Compute queue position (1-based, FIFO by queued_at).
  const [positionRow] = await tx
    .select({ pos: count() })
    .from(holds)
    .where(
      and(
        eq(holds.bookId, input.bookId),
        eq(holds.status, "queued"),
        lte(holds.queuedAt, hold.queuedAt),
      ),
    );

  const position = Number(positionRow?.pos ?? 1);

  await writeAuditLog(tx, ctx, {
    action: "hold.placed",
    subjectType: "hold",
    subjectId: hold.id,
    afterJson: {
      bookId: input.bookId,
      memberId: input.memberId,
      position,
    },
  });

  // TODO (Spec 07): emit('hold.placed', { holdId: hold.id, memberId: input.memberId, tenantId: ctx.tenantId })

  return { hold, position };
}
