/**
 * normalizePageContext — derives a stable, canonical thread key from the raw page_context
 * value supplied by the client.
 *
 * Rules (applied in order):
 *   1. Trim leading/trailing whitespace.
 *   2. Lowercase.
 *   3. Truncate to MAX_LEN characters (prevents DB column overflow and key divergence
 *      from minor client variations at the tail of long strings).
 *   4. If the result is empty after trimming, fall back to "global".
 *
 * Examples:
 *   "  Books  "     → "books"
 *   "book:abc-123"  → "book:abc-123"
 *   ""              → "global"
 *   (undefined/null callers should pass "global" before calling)
 */

const MAX_LEN = 120;

export function normalizePageContext(raw: string): string {
  const trimmed = raw.trim().toLowerCase().slice(0, MAX_LEN);
  return trimmed === "" ? "global" : trimmed;
}
