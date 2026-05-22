/**
 * getMemberById — resolves a member row by its UUID within the current tenant.
 *
 * RLS automatically scopes this to the caller's tenant_id; no extra WHERE clause
 * is required. Throws MemberNotFoundError if the row does not exist (or is
 * deleted / hidden by RLS).
 */

import type { Member } from "@/lib/db/schema/members";
import { members } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { eq } from "drizzle-orm";
import { MemberNotFoundError } from "./errors";

export async function getMemberById(
  tx: TxClient,
  _ctx: TenantCtx,
  memberId: string,
): Promise<Member> {
  const [row] = await tx.select().from(members).where(eq(members.id, memberId));

  if (!row) {
    throw new MemberNotFoundError(memberId);
  }

  return row;
}
