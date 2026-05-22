/**
 * listPendingMembers — paginated approval queue (REQ-04-03).
 *
 * Returns members with status='pending', ordered by created_at ASC (oldest first).
 * Cursor-based pagination: the cursor is the created_at timestamp of the last
 * item returned on the previous page (ISO 8601 string).
 *
 * RLS enforces tenant isolation — no explicit tenant_id WHERE needed.
 */

import { members } from "@/lib/db/schema/members";
import type { Member } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, asc, eq, gt } from "drizzle-orm";
import type { ListPendingMembersInput } from "./schemas";

export interface ListPendingMembersResult {
  members: ReadonlyArray<Member>;
  /** ISO 8601 cursor for the next page. Undefined if no more pages. */
  nextCursor: string | undefined;
}

export async function listPendingMembers(
  tx: TxClient,
  _ctx: TenantCtx,
  input: ListPendingMembersInput,
): Promise<ListPendingMembersResult> {
  const conditions = [eq(members.status, "pending")];

  if (input.cursor) {
    conditions.push(gt(members.createdAt, new Date(input.cursor)));
  }

  const rows = await tx
    .select()
    .from(members)
    .where(and(...conditions))
    .orderBy(asc(members.createdAt))
    .limit(input.limit + 1); // fetch one extra to determine if there's a next page

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const lastRow = page[page.length - 1];
  const nextCursor = hasMore && lastRow ? lastRow.createdAt.toISOString() : undefined;

  return { members: page, nextCursor };
}
