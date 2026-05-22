import { z } from "zod";

/**
 * ChatRequestSchema — the non-message fields parsed from the POST /api/chat/stream body.
 *
 * `messages` (UIMessage[]) is handled separately by the AI SDK's `convertToModelMessages`.
 * `pageContext` identifies which library page the chat was opened from — used to key the
 * persistent thread (one active thread per member per context).
 */
export const ChatRequestSchema = z.object({
  pageContext: z.string().min(1).max(120).default("global"),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
