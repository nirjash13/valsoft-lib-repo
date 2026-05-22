/**
 * getOrCreateThread — selects the active thread for (tenant, member, pageContext),
 * or inserts one if absent, and bumps last_message_at.
 *
 * "Active" means archived_at IS NULL. The partial unique index on
 * (tenant_id, member_id, page_context) WHERE archived_at IS NULL enforces
 * at most one active thread per combination.
 */

import { chatThreads } from "@/lib/db/schema/chat-threads";
import type { ChatThreadRow } from "@/lib/db/schema/chat-threads";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, isNull } from "drizzle-orm";

interface GetOrCreateThreadInput {
  memberId: string;
  pageContext: string;
}

export async function getOrCreateThread(
  tx: TxClient,
  ctx: TenantCtx,
  input: GetOrCreateThreadInput,
): Promise<ChatThreadRow> {
  const { memberId, pageContext } = input;

  // Select the existing active thread for this (tenant, member, page_context) combination.
  const [existing] = await tx
    .select()
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.tenantId, ctx.tenantId),
        eq(chatThreads.memberId, memberId),
        eq(chatThreads.pageContext, pageContext),
        isNull(chatThreads.archivedAt),
      ),
    )
    .limit(1);

  if (existing !== undefined) {
    // Bump last_message_at to track activity (used for archival cron — REQ-06-09).
    const [updated] = await tx
      .update(chatThreads)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(chatThreads.id, existing.id))
      .returning();

    // updated is always defined because we updated by PK that exists.
    // biome-ignore lint/style/noNonNullAssertion: id match guarantees row
    return updated!;
  }

  // Insert a new thread.
  const [created] = await tx
    .insert(chatThreads)
    .values({
      tenantId: ctx.tenantId,
      memberId,
      pageContext,
    })
    .returning();

  // biome-ignore lint/style/noNonNullAssertion: insert returning always yields a row
  return created!;
}
