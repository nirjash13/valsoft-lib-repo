/**
 * Reciprocal Rank Fusion (RRF) — pure function, no I/O.
 *
 * RRF combines ranked lists from multiple retrieval systems without requiring
 * score normalization. Formula: score(d) = Σ 1 / (k + rank_i(d))
 *
 * References:
 *   - Cormack, Clarke, Buettcher (2009) "Reciprocal Rank Fusion outperforms
 *     Condorcet and individual Rank Learning Methods"
 *   - k=60 is the canonical constant per REQ-05-01.
 *
 * Unit-tested in tests/unit/domain/search/rrf.test.ts.
 */

/**
 * Fuses two ranked lists using Reciprocal Rank Fusion.
 *
 * @param lexical  - Map of bookId → 1-based rank from lexical search (lower = better).
 * @param semantic - Map of bookId → 1-based rank from semantic search (lower = better).
 * @param k        - RRF constant (default 60 per REQ-05-01).
 * @returns        Map of bookId → fused RRF score (higher = more relevant).
 */
export function reciprocalRankFusion(
  lexical: ReadonlyMap<string, number>,
  semantic: ReadonlyMap<string, number>,
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();

  const accumulate = (rankMap: ReadonlyMap<string, number>) => {
    for (const [bookId, rank] of rankMap) {
      const contribution = 1 / (k + rank);
      scores.set(bookId, (scores.get(bookId) ?? 0) + contribution);
    }
  };

  accumulate(lexical);
  accumulate(semantic);

  return scores;
}
