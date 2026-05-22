/**
 * appendMessage — inserts a chat_messages row and bumps the parent thread's timestamps.
 *
 * Called from the stream onFinish callback for both the user's last message
 * and the assistant's final response.
 */

import { chatMessages } from "@/lib/db/schema/chat-messages";
import type { ChatMessageRow } from "@/lib/db/schema/chat-messages";
import { chatThreads } from "@/lib/db/schema/chat-threads";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { eq } from "drizzle-orm";

type MessageRole = "user" | "assistant";

interface AppendMessageInput {
  threadId: string;
  role: MessageRole;
  content: string;
  /**
   * UUID book IDs extracted from <book:UUID> tokens (assistant messages only).
   * Omit the property entirely (do not pass `undefined`) when there are no refs.
   */
  bookIds?: string[] | undefined;
}

export async function appendMessage(
  tx: TxClient,
  ctx: TenantCtx,
  input: AppendMessageInput,
): Promise<ChatMessageRow> {
  const { threadId, role, content, bookIds } = input;

  const [inserted] = await tx
    .insert(chatMessages)
    .values({
      tenantId: ctx.tenantId,
      threadId,
      role,
      content,
      ...(bookIds !== undefined && bookIds.length > 0 ? { bookIds } : {}),
    })
    .returning();

  // Bump parent thread timestamps so archival cron sees recent activity.
  await tx
    .update(chatThreads)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(chatThreads.id, threadId));

  // biome-ignore lint/style/noNonNullAssertion: insert returning always yields a row
  return inserted!;
}
