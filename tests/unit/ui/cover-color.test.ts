import { coverGradient } from "@/lib/utils/cover-color";
import { describe, expect, it } from "vitest";

/**
 * Load-bearing: coverGradient is a pure function used for the typographic cover
 * fallback (brief §design questions #3). If it broke, every book without a cover
 * URL would render without a background — the grid would look broken.
 *
 * Two load-bearing behaviors:
 * 1. Same title always produces the same gradient (stable, deterministic).
 * 2. Different titles produce different gradients (visual variety).
 */
describe("coverGradient", () => {
  it("is deterministic — same title always returns the same gradient", () => {
    const a = coverGradient("Clean Code");
    const b = coverGradient("Clean Code");
    expect(a).toBe(b);
  });

  it("produces different gradients for different titles", () => {
    const a = coverGradient("Clean Code");
    const b = coverGradient("The Pragmatic Programmer");
    expect(a).not.toBe(b);
  });

  it("returns a CSS linear-gradient string", () => {
    const result = coverGradient("Refactoring");
    expect(result).toMatch(/^linear-gradient/);
  });
});
