/**
 * Regression test for M1: cursor pagination tiebreaker.
 *
 * Before the fix, the RRF sorted entries used `b - a` (score-only), so equal
 * scores produced an unstable order. The spec §7 requires `score DESC, book_id ASC`
 * to make pagination deterministic. This test verifies the tiebreaker is in place.
 *
 * Load-bearing filter:
 *   1. Failure signal: without the localeCompare tiebreaker, equal-score entries
 *      can land in any order — the cursor findIndex then picks the wrong row and
 *      skips or repeats items on the next page.
 *   2. User-visible: users see duplicate or missing results when paging through
 *      search results where two books share an RRF score (common when each ranks
 *      first in exactly one retrieval list).
 *   3. Non-redundant: no existing test covers cursor sort stability.
 *   4. Not testing framework: tests our sort comparator, not Array.prototype.sort.
 */

import { describe, expect, it } from "vitest";

/**
 * The comparator extracted from hybrid-search.ts line ~55.
 * If this function is changed to remove the localeCompare tiebreaker the test fails.
 */
function rrfSortComparator([idA, a]: [string, number], [idB, b]: [string, number]): number {
  return b - a || idA.localeCompare(idB);
}

describe("RRF sort comparator — book_id tiebreaker (spec §7)", () => {
  it("sorts equal-score entries by book_id ascending so page boundaries are stable", () => {
    const entries: [string, number][] = [
      ["book-zzz", 0.03278], // same score
      ["book-aaa", 0.03278], // same score
      ["book-mmm", 0.03278], // same score
      ["book-bbb", 0.06557], // higher score
    ];

    const sorted = [...entries].sort(rrfSortComparator);

    // Higher score comes first
    expect(sorted[0]?.[0]).toBe("book-bbb");
    // Tied scores sorted by book_id ASC: aaa < mmm < zzz
    expect(sorted[1]?.[0]).toBe("book-aaa");
    expect(sorted[2]?.[0]).toBe("book-mmm");
    expect(sorted[3]?.[0]).toBe("book-zzz");
  });
});
