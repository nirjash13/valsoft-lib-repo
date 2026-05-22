/**
 * extractBookRefs — extracts de-duplicated, UUID-validated book IDs from assistant text.
 *
 * The Reader's Advisor system prompt instructs the model to inline book references as
 * `<book:UUID>` tokens (e.g. `<book:3fa85f64-5717-4562-b3fc-2c963f66afa6>`).
 * This parser pulls those UUIDs out so the route handler can persist them in
 * chat_messages.book_ids and the UI (Builder E) can render inline BookCard components.
 *
 * NOTE: This module has NO server-only imports — Builder E's UI parser also uses it.
 */

const BOOK_TOKEN_RE = /<book:([^>]+)>/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns de-duplicated, UUID-validated book IDs found in `text`.
 * Tokens with malformed UUIDs are silently dropped (REQ-06-05).
 *
 * @param text - Raw assistant response text possibly containing `<book:UUID>` tokens.
 */
export function extractBookRefs(text: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const match of text.matchAll(BOOK_TOKEN_RE)) {
    const candidate = match[1];
    if (candidate === undefined) continue;
    const lower = candidate.toLowerCase();
    if (!UUID_RE.test(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    results.push(lower);
  }

  return results;
}
