/**
 * listMembers — paginated member list for admin/librarian views (Spec 04 Run B).
 *
 * Cursor-based pagination ordered by created_at DESC. Defaults to active members.
 * Supports optional status and role filters via URL searchParams.
 *
 * RLS enforces tenant isolation automatically — no explicit tenant_id WHERE needed.
 */

import type { Member } from "@/lib/db/schema/members";
import { members } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, desc, eq, isNull, lt } from "drizzle-orm";

export interface ListMembersInput {
  /** Filter by status. Defaults to "active". Pass null to list all statuses. */
  status?: "active" | "pending" | "rejected" | "inactive" | "suspended" | null | undefined;
  /** Filter by role. Optional. */
  role?: "tenant_admin" | "librarian" | "member" | null | undefined;
  /** Cursor: created_at ISO string of last row on previous page. */
  cursor?: string | null | undefined;
  limit?: number | undefined;
}

export interface ListMembersResult {
  members: ReadonlyArray<Member>;
  /** ISO 8601 cursor for the next page. Undefined when no more pages. */
  nextCursor: string | undefined;
}

export async function listMembers(
  tx: TxClient,
  _ctx: TenantCtx,
  input: ListMembersInput = {},
): Promise<ListMembersResult> {
  const limit = input.limit ?? 20;
  const statusFilter = input.status === null ? undefined : (input.status ?? "active");

  const conditions = [isNull(members.deletedAt)];

  if (statusFilter !== undefined) {
    conditions.push(eq(members.status, statusFilter));
  }

  if (input.role) {
    conditions.push(eq(members.role, input.role));
  }

  if (input.cursor) {
    conditions.push(lt(members.createdAt, new Date(input.cursor)));
  }

  const rows = await tx
    .select()
    .from(members)
    .where(and(...conditions))
    .orderBy(desc(members.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = page[page.length - 1];
  const nextCursor = hasMore && lastRow ? lastRow.createdAt.toISOString() : undefined;

  return { members: page, nextCursor };
}
