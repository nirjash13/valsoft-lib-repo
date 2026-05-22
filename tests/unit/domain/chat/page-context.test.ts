import { normalizePageContext } from "@/lib/domain/chat/page-context";
import { describe, expect, it } from "vitest";

describe("normalizePageContext", () => {
  it("trims, lowercases, and passes through a normal context key", () => {
    expect(normalizePageContext("  Books  ")).toBe("books");
  });

  it("falls back to 'global' when the input is empty after trimming", () => {
    expect(normalizePageContext("   ")).toBe("global");
  });

  it("truncates a context key longer than 120 characters", () => {
    const long = "a".repeat(130);
    const result = normalizePageContext(long);
    expect(result).toHaveLength(120);
    expect(result).toBe("a".repeat(120));
  });
});
