/**
 * listHoldsByMember — "My holds" view for a member.
 */

import { holds } from "@/lib/db/schema/holds";
import type { HoldRow } from "@/lib/db/schema/holds";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, asc, eq, inArray } from "drizzle-orm";

/**
 * Returns active (queued + ready) holds for a member, ordered by queued_at.
 */
export async function listHoldsByMember(
  tx: TxClient,
  _ctx: TenantCtx,
  memberId: string,
): Promise<ReadonlyArray<HoldRow>> {
  return tx
    .select()
    .from(holds)
    .where(and(eq(holds.memberId, memberId), inArray(holds.status, ["queued", "ready"])))
    .orderBy(asc(holds.queuedAt));
}
