import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/lib/notifications/unsubscribe-token";
import { describe, expect, it } from "vitest";

describe("unsubscribe-token", () => {
  it("sign→verify round-trip returns the original memberId", () => {
    const memberId = "member-abc-123";
    const token = signUnsubscribeToken(memberId);
    expect(verifyUnsubscribeToken(token)).toBe(memberId);
  });

  it("returns null for a tampered token (flipped HMAC byte)", () => {
    const memberId = "member-abc-123";
    const token = signUnsubscribeToken(memberId);
    // Corrupt the last character of the token to simulate tampering.
    const lastChar = token.at(-1);
    const tamperedToken = token.slice(0, -1) + (lastChar === "A" ? "B" : "A");
    expect(verifyUnsubscribeToken(tamperedToken)).toBeNull();
  });
});
