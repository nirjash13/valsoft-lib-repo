/**
 * getMemberByUserId — resolve a member row by Auth0 user ID (sub claim).
 *
 * Replaces the Spec 03 forward-compat stub. Now that Spec 04 has added
 * `auth0_user_id` to the members table (migration 0007), this performs a real
 * query: SELECT WHERE auth0_user_id = $1 AND deleted_at IS NULL.
 *
 * RLS scopes the query to the caller's tenant automatically. Returns null if:
 *   - No member row in this tenant has the given auth0_user_id.
 *   - The member row has been soft-deleted.
 *
 * Callers (holds/actions.ts, loans/actions.ts) remain unchanged because the
 * signature is identical to the stub: (tx, ctx, userId) => Promise<Member | null>.
 */

import type { Member } from "@/lib/db/schema/members";
import { members } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, isNull } from "drizzle-orm";

export async function getMemberByUserId(
  tx: TxClient,
  _ctx: TenantCtx,
  userId: string,
): Promise<Member | null> {
  const [row] = await tx
    .select()
    .from(members)
    .where(and(eq(members.auth0UserId, userId), isNull(members.deletedAt)))
    .limit(1);

  return row ?? null;
}
