import { isRefusalText } from "@/lib/domain/chat/refusal";
import { describe, expect, it } from "vitest";

describe("isRefusalText", () => {
  it("returns true for the exact canned refusal phrase mandated by the prompt", () => {
    const refusal =
      "I can only help with books in this library's catalog — would you like book recommendations on a topic instead?";
    expect(isRefusalText(refusal)).toBe(true);
  });

  it("returns false for a normal catalog recommendation that does not contain the refusal phrase", () => {
    const recommendation =
      "Based on your interest in mystery, I recommend *Gone Girl* by Gillian Flynn.\n<book:abc-123>";
    expect(isRefusalText(recommendation)).toBe(false);
  });
});
