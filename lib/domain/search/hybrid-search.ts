/**
 * hybrid-search — orchestrates lexical + semantic search with RRF fusion.
 *
 * Flow (REQ-05-01, REQ-05-02, REQ-05-06, REQ-05-08):
 *   1. Parse and validate input via SearchInputSchema.
 *   2. Run lexical + semantic searches in parallel (Promise.all).
 *   3. Fuse results via RRF (k=60).
 *   4. Sort by RRF score DESC; apply cursor-based pagination.
 *   5. Join books table for full metadata (soft-delete filter is IN query-level).
 *   6. Compute facets from the full (pre-pagination) candidate set.
 *   7. Log zero-result queries.
 *
 * The soft-delete filter `deleted_at IS NULL` is applied inside lexicalSearch
 * and semanticSearch so excluded books never reach the fusion stage (REQ-05-04).
 */

import { db } from "@/lib/db/client";
import type { TenantId } from "@/lib/db/schema/_shared";
import { books } from "@/lib/db/schema/books";
import { searchZeroResultLog } from "@/lib/db/schema/search-zero-result-log";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { computeFacets } from "./compute-facets";
import { lexicalSearch } from "./lexical-search";
import { reciprocalRankFusion } from "./rrf";
import type { SearchInput, SearchResponse, SearchResult } from "./schemas";
import { semanticSearch } from "./semantic-search";

/**
 * Executes hybrid search for the given input.
 *
 * @param tx    - Active tenant-scoped transaction.
 * @param ctx   - Tenant context (tenantId, userId).
 * @param input - Validated SearchInput (SearchInputSchema already applied by caller).
 * @returns     SearchResponse with results, facets, totalCount, and cursor.
 */
export async function hybridSearch(
  tx: TxClient,
  ctx: TenantCtx,
  input: SearchInput,
): Promise<SearchResponse> {
  const tenantId = ctx.tenantId as TenantId;

  // --- 1. Run retrieval systems in parallel ---
  const [lexical, semantic] = await Promise.all([
    lexicalSearch(tx, input.query, input.filters),
    input.mode === "public_lexical_only"
      ? Promise.resolve<ReadonlyMap<string, number>>(new Map())
      : semanticSearch(tx, tenantId, input.query, input.filters),
  ]);

  // --- 2. Fuse via RRF (k=60 per REQ-05-01) ---
  const fused = reciprocalRankFusion(lexical, semantic, 60);

  // --- 3. Sort by score DESC then book_id ASC tiebreaker (spec §7), apply 50-book cap ---
  const sortedEntries = [...fused.entries()]
    .sort(([idA, a], [idB, b]) => b - a || idA.localeCompare(idB))
    .slice(0, 50);

  const totalCount = sortedEntries.length;

  // --- 4. Zero-result logging (REQ-05-08) ---
  if (totalCount === 0) {
    // Write the zero-result log in its own independent committed transaction so
    // the row is durable regardless of what happens to the surrounding search tx.
    // Best-effort: if the log write fails, the search response is still returned.
    void db
      .transaction(async (logTx) => {
        await logTx.execute(sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`);
        await logTx.execute(sql`SELECT set_config('app.user_id', ${ctx.userId}, true)`);
        await logTx.insert(searchZeroResultLog).values({
          tenantId: ctx.tenantId,
          query: input.query,
          userId: ctx.userId ?? null,
        });
      })
      .catch((err) => {
        console.warn(`[hybridSearch] zero-result log failed — tenant=${ctx.tenantId}`, err);
      });

    return {
      results: [],
      facets: {
        subjects: [],
        languages: [],
        availability: { inStock: 0, onLoan: 0 },
        yearBuckets: [],
      },
      totalCount: 0,
      cursor: undefined,
    };
  }

  // --- 5. Cursor-based pagination ---
  // Cursor encodes: base64("score:bookId") of the last item on the previous page.
  let startIndex = 0;
  if (input.cursor) {
    try {
      const decoded = Buffer.from(input.cursor, "base64").toString("utf8");
      const [scoreStr, bookId] = decoded.split(":");
      const cursorScore = Number.parseFloat(scoreStr ?? "");
      if (Number.isFinite(cursorScore) && bookId) {
        const idx = sortedEntries.findIndex(
          ([id, score]) => score === cursorScore && id === bookId,
        );
        if (idx !== -1) startIndex = idx + 1;
      }
    } catch {
      // Invalid cursor — start from beginning
    }
  }

  const pageEntries = sortedEntries.slice(startIndex, startIndex + input.limit);

  // --- 6. Fetch full book metadata for page results ---
  const pageBookIds = pageEntries.map(([id]) => id);
  const scoreMap = new Map(pageEntries);

  let bookRows: Array<{
    id: string;
    title: string;
    authors: string[];
    year: number | null;
    language: string | null;
    subjects: string[] | null;
    coverUrl: string | null;
    description: string | null;
    deletedAt: Date | null;
  }> = [];

  if (pageBookIds.length > 0) {
    bookRows = await tx
      .select({
        id: books.id,
        title: books.title,
        authors: books.authors,
        year: books.year,
        language: books.language,
        subjects: books.subjects,
        coverUrl: books.coverUrl,
        description: books.description,
        deletedAt: books.deletedAt,
      })
      .from(books)
      .where(and(inArray(books.id, pageBookIds), isNull(books.deletedAt)));
  }

  // Preserve RRF sort order
  const bookMap = new Map(bookRows.map((b) => [b.id, b]));
  const results: SearchResult[] = pageBookIds
    .map((id) => {
      const book = bookMap.get(id);
      if (!book) return null;
      return {
        bookId: book.id,
        title: book.title,
        authors: book.authors,
        year: book.year,
        language: book.language,
        subjects: book.subjects,
        coverUrl: book.coverUrl,
        description: book.description,
        deletedAt: book.deletedAt,
        score: scoreMap.get(id) ?? 0,
      } satisfies SearchResult;
    })
    .filter((r): r is SearchResult => r !== null);

  // --- 7. Compute facets over the full candidate set (REQ-05-06) ---
  const allCandidateIds = sortedEntries.map(([id]) => id);
  const facets = await computeFacets(tx, allCandidateIds);

  // --- 8. Build next cursor ---
  const lastEntry = pageEntries[pageEntries.length - 1];
  const hasNextPage = startIndex + input.limit < sortedEntries.length;
  const cursor =
    hasNextPage && lastEntry
      ? Buffer.from(`${lastEntry[1]}:${lastEntry[0]}`).toString("base64")
      : undefined;

  return { results, facets, totalCount, cursor };
}
