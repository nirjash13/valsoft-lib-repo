/**
 * searchMembers — quick member lookup for the checkout dialog (Spec 03 circulation).
 *
 * Returns up to 10 active, non-deleted members whose display_name or email
 * contains the query string (case-insensitive). When query is empty, returns
 * the 10 most recently created active members so the dialog has useful content
 * on first open.
 *
 * RLS enforces tenant isolation — no explicit tenant_id WHERE is needed.
 */

import { members } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

export interface MemberSearchResult {
  id: string;
  displayName: string;
  email: string;
}

export async function searchMembers(
  tx: TxClient,
  _ctx: TenantCtx,
  query: string,
): Promise<ReadonlyArray<MemberSearchResult>> {
  const trimmed = query.trim();

  const baseConditions = [eq(members.status, "active"), isNull(members.deletedAt)];

  const conditions =
    trimmed.length > 0
      ? [
          ...baseConditions,
          or(
            sql`lower(${members.displayName}) ILIKE ${`%${trimmed.toLowerCase()}%`}`,
            sql`lower(${members.email}) ILIKE ${`%${trimmed.toLowerCase()}%`}`,
          ),
        ]
      : baseConditions;

  const rows = await tx
    .select({
      id: members.id,
      displayName: members.displayName,
      email: members.email,
    })
    .from(members)
    .where(and(...conditions))
    .orderBy(desc(members.createdAt))
    .limit(10);

  return rows;
}
