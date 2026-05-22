/**
 * Regression test for REQ-07-03: welcome email must include the library card number.
 *
 * Load-bearing: if generateCardNumber returns a different or empty value for the same
 * memberId, the welcome email will display the wrong card number (or none) — visible
 * user-facing breakage per US-03.
 */

import { generateCardNumber } from "@/lib/domain/members/generate-card-number";
import { describe, expect, it } from "vitest";

describe("generateCardNumber", () => {
  it("produces a stable LIB-XXXXXXXX code that matches the SQL backfill formula", () => {
    // The SQL backfill in 0015_member_card_number.sql does:
    //   'LIB-' || upper(substring(replace(id::text, '-', '') FROM 1 FOR 8))
    // This test pins that both implementations agree on the same input.
    const memberId = "1a2b3c4d-e5f6-7890-abcd-ef1234567890";
    const result = generateCardNumber(memberId);
    // Strips hyphens → "1a2b3c4de5f67890abcdef1234567890", takes first 8 → "1a2b3c4d", upcase → "1A2B3C4D"
    expect(result).toBe("LIB-1A2B3C4D");
  });
});
