/**
 * generateCardNumber — derives a stable, human-readable library card number
 * from a member UUID (Spec 07 REQ-07-03).
 *
 * Format: LIB-<8 uppercase hex chars>
 * Example: LIB-1A2B3C4D
 *
 * The output is deterministic: the same memberId always produces the same code.
 * This matches the backfill formula in 0015_member_card_number.sql so existing
 * rows and newly-approved rows always agree.
 *
 * Pure function — no I/O, no side effects.
 */
export function generateCardNumber(memberId: string): string {
  // Strip hyphens from the UUID and take the first 8 hex chars.
  const hex = memberId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `LIB-${hex}`;
}
