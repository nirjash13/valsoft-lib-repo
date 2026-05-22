import { estimateCostUsd, routeModel } from "@/lib/ai/routing";
import { describe, expect, it } from "vitest";

describe("routeModel", () => {
  it("returns the primary slug for a known feature", () => {
    expect(routeModel("readers_advisor")).toBe("anthropic/claude-sonnet-4-6");
    expect(routeModel("isbn_enrich")).toBe("anthropic/claude-haiku-4-5");
  });

  it("falls back to Sonnet 4.6 for an unknown feature", () => {
    expect(routeModel("not_a_feature")).toBe("anthropic/claude-sonnet-4-6");
  });
});

describe("estimateCostUsd", () => {
  it("computes cost correctly from token counts for readers_advisor", () => {
    // readers_advisor: $0.003/1k input, $0.015/1k output
    // 1000 input + 500 output → 0.003 + 0.0075 = 0.0105
    const cost = estimateCostUsd("readers_advisor", { inputTokens: 1000, outputTokens: 500 });
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it("returns 0 for an unknown feature", () => {
    expect(estimateCostUsd("unknown_feature", { inputTokens: 1000, outputTokens: 500 })).toBe(0);
  });
});
