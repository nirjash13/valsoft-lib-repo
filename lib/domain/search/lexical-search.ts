/**
 * Lexical search — tsvector full-text + trigram fallback.
 *
 * Strategy (REQ-05-01, REQ-05-02):
 *   1. Primary: Postgres `websearch_to_tsquery` over the weighted tsvector GIN index.
 *      Uses ts_rank_cd for document scoring; returns up to 50 books.
 *   2. Fallback: If the primary returns 0 results (stopwords-only or short token),
 *      fall back to trigram similarity on title + authors.
 *
 * The query is NOT sanitized for SQL injection because we use parameterized
 * queries via Drizzle's `sql` template tag — the query string is a bound $1
 * parameter to websearch_to_tsquery, never interpolated into raw SQL.
 *
 * Returns a Map of bookId → 1-based rank (rank 1 = most relevant).
 */

import type { TxClient } from "@/lib/db/with-tenant-tx";
import { sql } from "drizzle-orm";
import type { SearchFilters } from "./schemas";

interface LexicalRow extends Record<string, unknown> {
  book_id: string;
}

/**
 * Sanitizes a query string for use as a tsquery input.
 *
 * `websearch_to_tsquery` is already injection-safe (it's a parameterized call),
 * but we do one additional guard: if the query contains only SQL meta-characters
 * that could confuse `websearch_to_tsquery` parsing, we strip them.
 *
 * The primary concern is single-quote injection into the tsquery string itself.
 * `websearch_to_tsquery($1)` uses the query as a bound parameter so no injection
 * is possible, but we still normalize for query quality (empty queries, excess
 * whitespace, quotes that would produce parse errors in tsquery).
 *
 * Exported for unit testing of the sanitization boundary.
 */
export function sanitizeLexicalQuery(raw: string): string {
  // Remove characters that break websearch_to_tsquery syntax.
  // Single quotes can cause syntax errors inside websearch_to_tsquery when
  // the string is not a parameter (defensive; they ARE parameters here).
  return raw
    .replace(/'/g, " ") // single quotes → space (prevents tsquery parse errors)
    .trim();
}

/**
 * Executes lexical search against the books tsvector + trigram indexes.
 *
 * @param tx      - Active tenant-scoped transaction (RLS enforced).
 * @param query   - Raw search query string.
 * @param filters - Optional facet filters (applied as WHERE clauses on candidates).
 * @returns       Map of bookId → 1-based rank (1 = best match).
 */
export async function lexicalSearch(
  tx: TxClient,
  query: string,
  filters?: SearchFilters,
): Promise<ReadonlyMap<string, number>> {
  const sanitized = sanitizeLexicalQuery(query);
  if (!sanitized) return new Map();

  // Build the subject filter fragment (if supplied)
  const hasSubjectFilter = filters?.subjects && filters.subjects.length > 0;
  const hasLanguageFilter = typeof filters?.language === "string";
  const hasYearFromFilter = typeof filters?.yearFrom === "number";
  const hasYearToFilter = typeof filters?.yearTo === "number";
  const availabilityFilter = filters?.availability;

  // Primary: tsvector full-text search with weights
  // websearch_to_tsquery handles complex user input (phrases, negation, OR)
  // and is injection-safe as a parameterized function call.
  const primaryRows = await tx.execute<LexicalRow>(sql`
    SELECT b.id AS book_id
    FROM books b
    WHERE
      b.deleted_at IS NULL
      AND b.tsv @@ websearch_to_tsquery('english', ${sanitized})
      ${hasSubjectFilter ? sql`AND b.subjects && ${filters?.subjects}::text[]` : sql``}
      ${hasLanguageFilter ? sql`AND b.language = ${filters?.language}` : sql``}
      ${hasYearFromFilter ? sql`AND b.year >= ${filters?.yearFrom}` : sql``}
      ${hasYearToFilter ? sql`AND b.year <= ${filters?.yearTo}` : sql``}
      ${availabilityFilter === "on_loan" ? sql`AND EXISTS (SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL)` : sql``}
      ${availabilityFilter === "in_stock" ? sql`AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL)` : sql``}
    ORDER BY ts_rank_cd(b.tsv, websearch_to_tsquery('english', ${sanitized}), 32) DESC
    LIMIT 50
  `);

  if (primaryRows.rows.length > 0) {
    return buildRankMap(primaryRows.rows);
  }

  // Fallback: trigram similarity on title + authors when full-text finds nothing.
  // Threshold 0.1 catches mild typos; the similarity score acts as rank proxy.
  const fallbackRows = await tx.execute<LexicalRow>(sql`
    SELECT b.id AS book_id
    FROM books b
    WHERE
      b.deleted_at IS NULL
      AND (
        b.title % ${sanitized}
        OR immutable_array_to_string(b.authors, ' ') % ${sanitized}
      )
      ${hasSubjectFilter ? sql`AND b.subjects && ${filters?.subjects}::text[]` : sql``}
      ${hasLanguageFilter ? sql`AND b.language = ${filters?.language}` : sql``}
      ${hasYearFromFilter ? sql`AND b.year >= ${filters?.yearFrom}` : sql``}
      ${hasYearToFilter ? sql`AND b.year <= ${filters?.yearTo}` : sql``}
      ${availabilityFilter === "on_loan" ? sql`AND EXISTS (SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL)` : sql``}
      ${availabilityFilter === "in_stock" ? sql`AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL)` : sql``}
    ORDER BY
      greatest(
        similarity(b.title, ${sanitized}),
        similarity(immutable_array_to_string(b.authors, ' '), ${sanitized})
      ) DESC
    LIMIT 50
  `);

  return buildRankMap(fallbackRows.rows);
}

function buildRankMap(rows: LexicalRow[]): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  rows.forEach((row, index) => {
    map.set(row.book_id, index + 1); // 1-based rank
  });
  return map;
}
