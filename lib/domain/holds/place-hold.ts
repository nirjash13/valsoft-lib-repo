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
  // 1. Hold only makes sense when the book is borrowed.
  const active = await hasActiveLoan(tx, input.bookId);
  if (!active) {
    throw new HoldNotPlaceableError(input.bookId);
  }

  // 2. Verify member is active.
  const [member] = await tx.select().from(members).where(eq(members.id, input.memberId));

  if (!member || member.status !== "active") {
    throw new MemberNotActiveError(input.memberId);
  }

  // 3. Insert — the partial UNIQUE INDEX will reject duplicates.
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

  // 4. Compute queue position (1-based, FIFO by queued_at).
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
