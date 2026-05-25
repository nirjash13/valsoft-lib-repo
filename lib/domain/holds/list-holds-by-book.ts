/**
 * listHoldsByBook — queue view for a specific book (librarian/admin).
 *
 * Joins with `members` so the UI can render the member display name and email
 * instead of a raw UUID slice. Mirrors the `listActiveLoans` shape.
 */

import { holds } from "@/lib/db/schema/holds";
import type { HoldRow } from "@/lib/db/schema/holds";
import { members } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, asc, eq, inArray } from "drizzle-orm";

export interface BookHoldItem extends HoldRow {
  memberDisplayName: string;
  memberEmail: string;
}

/**
 * Returns the full hold queue for a book (queued + ready), joined with the
 * member row, ordered by queued_at FIFO.
 */
export async function listHoldsByBook(
  tx: TxClient,
  _ctx: TenantCtx,
  bookId: string,
): Promise<ReadonlyArray<BookHoldItem>> {
  const rows = await tx
    .select({
      hold: holds,
      memberDisplayName: members.displayName,
      memberEmail: members.email,
    })
    .from(holds)
    .innerJoin(members, eq(members.id, holds.memberId))
    .where(and(eq(holds.bookId, bookId), inArray(holds.status, ["queued", "ready"])))
    .orderBy(asc(holds.queuedAt));

  return rows.map((row) => ({
    ...row.hold,
    memberDisplayName: row.memberDisplayName,
    memberEmail: row.memberEmail,
  }));
}
