/**
 * Refusal detection for the Reader's Advisor chat.
 *
 * The system prompt (readers-advisor.v1.md §3) mandates a specific canned phrase
 * for off-catalog refusals. Detecting that phrase — rather than using a proxy
 * heuristic like "0 tool calls" — is the single source of truth for whether the
 * model refused an off-catalog question (REQ-06-06).
 *
 * This module is intentionally pure (no server-only imports) so it can be
 * imported by both the Route Handler and client components.
 */

/**
 * Stable substring from the mandatory refusal sentence in readers-advisor.v1.md:
 *   "I can only help with books in this library's catalog — would you like
 *    book recommendations on a topic instead?"
 *
 * Keep this aligned with the prompt. If the prompt's refusal wording changes,
 * bump the prompt version (per REQ-11-09) AND update this constant in the
 * same PR.
 */
export const REFUSAL_SUBSTRING = "I can only help with books in this library's catalog";

/**
 * Returns true when the assistant text contains the canonical refusal phrase.
 *
 * Case-insensitive to tolerate minor model capitalization drift on the leading "I".
 * The substring is long enough to avoid false positives on normal catalog text.
 */
export function isRefusalText(text: string): boolean {
  return text.toLowerCase().includes(REFUSAL_SUBSTRING.toLowerCase());
}
