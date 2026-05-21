/**
 * listHoldsByBook — queue view for a specific book (librarian/admin).
 */

import { holds } from "@/lib/db/schema/holds";
import type { HoldRow } from "@/lib/db/schema/holds";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, asc, eq, inArray } from "drizzle-orm";

/**
 * Returns the full hold queue for a book (queued + ready), ordered by queued_at FIFO.
 */
export async function listHoldsByBook(
  tx: TxClient,
  _ctx: TenantCtx,
  bookId: string,
): Promise<ReadonlyArray<HoldRow>> {
  return tx
    .select()
    .from(holds)
    .where(and(eq(holds.bookId, bookId), inArray(holds.status, ["queued", "ready"])))
    .orderBy(asc(holds.queuedAt));
}
