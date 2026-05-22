/**
 * Chat domain error classes — typed, narrow.
 *
 * These are thrown by domain functions and mapped to HTTP responses
 * by the route handler (never leak internal detail to the client).
 */

export class ChatThreadNotFoundError extends Error {
  override readonly name = "ChatThreadNotFoundError";
  constructor(threadId: string) {
    super(`Chat thread ${threadId} not found`);
  }
}

export class ChatMemberRequiredError extends Error {
  override readonly name = "ChatMemberRequiredError";
  constructor() {
    super("A member record is required to persist a chat thread");
  }
}
