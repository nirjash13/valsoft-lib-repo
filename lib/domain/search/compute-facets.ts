/**
 * compute-facets — compute facet counts from a candidate book ID set (REQ-05-06).
 *
 * Runs a single SQL query over the candidate book IDs to compute:
 *   - subjects: top 8 subjects by count
 *   - languages: all languages by count
 *   - availability: in_stock vs on_loan (based on active loans)
 *   - yearBuckets: decade distribution
 *
 * Availability counting is a heuristic join on loans WHERE returned_at IS NULL.
 * This is a read within the same transaction so it sees the RLS-filtered view.
 */

import type { TxClient } from "@/lib/db/with-tenant-tx";
import { sql } from "drizzle-orm";
import type { FacetBucket, Facets, YearBucket } from "./schemas";

interface SubjectRow extends Record<string, unknown> {
  subject: string;
  cnt: string;
}

interface LanguageRow extends Record<string, unknown> {
  language: string;
  cnt: string;
}

interface AvailabilityRow extends Record<string, unknown> {
  in_stock: string;
  on_loan: string;
}

interface YearRow extends Record<string, unknown> {
  decade: string;
  cnt: string;
}

/**
 * Computes facets for the given candidate book IDs.
 *
 * @param tx         - Active tenant-scoped transaction.
 * @param bookIds    - Array of UUIDs from the RRF-fused result set.
 * @returns          Computed facets; empty buckets when bookIds is empty.
 */
export async function computeFacets(tx: TxClient, bookIds: string[]): Promise<Facets> {
  if (bookIds.length === 0) {
    return {
      subjects: [],
      languages: [],
      availability: { inStock: 0, onLoan: 0 },
      yearBuckets: [],
    };
  }

  // Use a temporary VALUES list for the candidate IDs.
  // We pass them as a Postgres array literal for simplicity.
  const idList = sql.join(
    bookIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  const [subjectRows, languageRows, availabilityRows, yearRows] = await Promise.all([
    // Top 8 subjects
    tx.execute<SubjectRow>(sql`
      SELECT s.subject, COUNT(*)::text AS cnt
      FROM books b, unnest(b.subjects) AS s(subject)
      WHERE b.id IN (${idList})
        AND b.deleted_at IS NULL
      GROUP BY s.subject
      ORDER BY cnt DESC
      LIMIT 8
    `),

    // All languages
    tx.execute<LanguageRow>(sql`
      SELECT b.language, COUNT(*)::text AS cnt
      FROM books b
      WHERE b.id IN (${idList})
        AND b.deleted_at IS NULL
        AND b.language IS NOT NULL
      GROUP BY b.language
      ORDER BY cnt DESC
    `),

    // Availability: count distinct books that have / lack an active loan row.
    // Using EXISTS/NOT EXISTS avoids fan-out when a book has multiple loan rows
    // (e.g. multi-copy model), which would inflate COUNT with a LEFT JOIN.
    tx.execute<AvailabilityRow>(sql`
      SELECT
        COUNT(DISTINCT CASE WHEN NOT EXISTS (
          SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL
        ) THEN b.id END)::text AS in_stock,
        COUNT(DISTINCT CASE WHEN EXISTS (
          SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL
        ) THEN b.id END)::text AS on_loan
      FROM books b
      WHERE b.id IN (${idList})
        AND b.deleted_at IS NULL
    `),

    // Year distribution (decade buckets)
    tx.execute<YearRow>(sql`
      SELECT
        (floor(b.year::float / 10) * 10)::integer::text AS decade,
        COUNT(*)::text AS cnt
      FROM books b
      WHERE b.id IN (${idList})
        AND b.deleted_at IS NULL
        AND b.year IS NOT NULL
      GROUP BY decade
      ORDER BY decade DESC
    `),
  ]);

  const subjects: FacetBucket[] = subjectRows.rows.map((r) => ({
    value: r.subject,
    count: Number.parseInt(r.cnt, 10),
  }));

  const languages: FacetBucket[] = languageRows.rows.map((r) => ({
    value: r.language,
    count: Number.parseInt(r.cnt, 10),
  }));

  const avRow = availabilityRows.rows[0];
  const availability = {
    inStock: avRow ? Number.parseInt(avRow.in_stock, 10) : 0,
    onLoan: avRow ? Number.parseInt(avRow.on_loan, 10) : 0,
  };

  const yearBuckets: YearBucket[] = yearRows.rows.map((r) => ({
    decade: Number.parseInt(r.decade, 10),
    count: Number.parseInt(r.cnt, 10),
  }));

  return { subjects, languages, availability, yearBuckets };
}
