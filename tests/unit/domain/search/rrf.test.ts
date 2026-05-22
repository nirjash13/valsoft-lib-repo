/**
 * Unit tests for Reciprocal Rank Fusion (RRF).
 *
 * Load-bearing filter applied:
 *   1. Failure signal: each test would fail if the RRF formula is broken.
 *   2. User-visible: incorrect ranking produces wrong search order (visible to users).
 *   3. Non-redundant: no other test covers this pure function.
 *   4. Not testing the framework: tests our implementation, not Map or Math.
 */

import { reciprocalRankFusion } from "@/lib/domain/search/rrf";
import { describe, expect, it } from "vitest";

describe("reciprocalRankFusion", () => {
  it("produces correct scores for a document appearing in both lists", () => {
    // Book A: rank 1 in lexical, rank 1 in semantic → score = 1/(60+1) + 1/(60+1)
    const lexical = new Map([["book-a", 1]]);
    const semantic = new Map([["book-a", 1]]);
    const result = reciprocalRankFusion(lexical, semantic);

    const expected = 2 / 61; // 1/61 + 1/61
    expect(result.get("book-a")).toBeCloseTo(expected, 10);
  });

  it("books appearing in both ranked lists score higher than books in one list only", () => {
    // book-both: rank 1 in each → higher than book-lexical-only at rank 1 in one list
    const lexical = new Map([
      ["book-both", 1],
      ["book-lexical-only", 2],
    ]);
    const semantic = new Map([["book-both", 1]]);

    const result = reciprocalRankFusion(lexical, semantic);

    const bothScore = result.get("book-both") ?? 0;
    const lexOnlyScore = result.get("book-lexical-only") ?? 0;

    expect(bothScore).toBeGreaterThan(lexOnlyScore);
  });

  it("books appearing only in the lexical list still receive a positive score", () => {
    const lexical = new Map([["book-a", 5]]);
    const semantic = new Map<string, number>();

    const result = reciprocalRankFusion(lexical, semantic);

    const score = result.get("book-a") ?? 0;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeCloseTo(1 / (60 + 5), 10); // 1/(k+rank)
  });

  it("returns an empty map when both input maps are empty", () => {
    const result = reciprocalRankFusion(new Map(), new Map());
    expect(result.size).toBe(0);
  });
});
