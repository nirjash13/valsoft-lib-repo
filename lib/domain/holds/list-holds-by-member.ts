/**
 * listHoldsByMember — "My holds" view for a member.
 *
 * Joins with `books` so the UI can render the book title and authors instead of
 * a raw UUID slice. Mirrors the `listActiveLoans` shape.
 */

import { books } from "@/lib/db/schema/books";
import { holds } from "@/lib/db/schema/holds";
import type { HoldRow } from "@/lib/db/schema/holds";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, asc, eq, inArray } from "drizzle-orm";

export interface MemberHoldItem extends HoldRow {
  bookTitle: string;
  bookAuthors: ReadonlyArray<string>;
}

/**
 * Returns active (queued + ready) holds for a member, joined with the book
 * row, ordered by queued_at.
 */
export async function listHoldsByMember(
  tx: TxClient,
  _ctx: TenantCtx,
  memberId: string,
): Promise<ReadonlyArray<MemberHoldItem>> {
  const rows = await tx
    .select({
      hold: holds,
      bookTitle: books.title,
      bookAuthors: books.authors,
    })
    .from(holds)
    .innerJoin(books, eq(books.id, holds.bookId))
    .where(and(eq(holds.memberId, memberId), inArray(holds.status, ["queued", "ready"])))
    .orderBy(asc(holds.queuedAt));

  return rows.map((row) => ({
    ...row.hold,
    bookTitle: row.bookTitle,
    bookAuthors: row.bookAuthors ?? [],
  }));
}
