/**
 * logRefusal — inserts a chat_refusals row for REQ-06-06 / US-05 librarian visibility.
 *
 * reason: "off_catalog" — question outside the library catalog (no tool calls made).
 *         "policy"      — prompt injection or usage policy violation.
 *         "error"       — gateway/model failure caused a safe refusal fallback.
 */

import { chatRefusals } from "@/lib/db/schema/chat-refusals";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";

type RefusalReason = "off_catalog" | "policy" | "error";

interface LogRefusalInput {
  threadId?: string;
  memberId?: string;
  userMessage: string;
  reason: RefusalReason;
}

export async function logRefusal(
  tx: TxClient,
  ctx: TenantCtx,
  input: LogRefusalInput,
): Promise<void> {
  const { threadId, memberId, userMessage, reason } = input;

  await tx.insert(chatRefusals).values({
    tenantId: ctx.tenantId,
    ...(threadId !== undefined ? { threadId } : {}),
    ...(memberId !== undefined ? { memberId } : {}),
    userMessage,
    refusalReason: reason,
  });
}
