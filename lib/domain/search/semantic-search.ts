/**
 * Semantic search — pgvector cosine ANN query over book_embeddings.
 *
 * Strategy (REQ-05-01, REQ-05-02):
 *   1. Generate a query embedding via the AI Gateway.
 *   2. Query book_embeddings using HNSW index for approximate nearest neighbours.
 *   3. Filter to cosine similarity >= 0.30 (REQ-05-02).
 *   4. Return ranked Map (rank 1 = most similar).
 *
 * The AI_SEARCH_ENABLED guard lets operators disable semantic search without
 * a deploy (feature flag pattern). When disabled, returns an empty map so
 * hybridSearch gracefully falls back to lexical-only results.
 */

import { assertAiBudget } from "@/lib/ai/budget";
import { generateEmbedding } from "@/lib/ai/gateway";
import { recordAiUsage } from "@/lib/ai/usage";
import type { TenantId } from "@/lib/db/schema/_shared";
import { EMBEDDING_COST_USD, EMBEDDING_MODEL_VERSION } from "@/lib/db/schema/book-embeddings";
import type { TxClient } from "@/lib/db/with-tenant-tx";
import { sql } from "drizzle-orm";
import { EmbeddingFailedError } from "./errors";
import type { SearchFilters } from "./schemas";

interface SemanticRow extends Record<string, unknown> {
  book_id: string;
  distance: number;
}

/** Minimum cosine similarity to include a semantic match (REQ-05-02). */
const MIN_COSINE_SIMILARITY = 0.3;

/**
 * Runs semantic ANN search for the given query text.
 *
 * @param tx       - Active tenant-scoped transaction.
 * @param tenantId - The current tenant (for budget pre-check).
 * @param query    - Raw search query string.
 * @param filters  - Optional facet filters (applied via join to books).
 * @returns        Map of bookId → 1-based rank (1 = most similar).
 *                 Returns empty Map if AI_SEARCH_ENABLED is not "true" or
 *                 if the embedding fails gracefully (caller falls back to lexical).
 */
export async function semanticSearch(
  tx: TxClient,
  tenantId: TenantId,
  query: string,
  filters?: SearchFilters,
): Promise<ReadonlyMap<string, number>> {
  if (process.env.AI_SEARCH_ENABLED !== "true") {
    return new Map();
  }

  let embeddingVector: number[];
  try {
    await assertAiBudget(tenantId, EMBEDDING_COST_USD);
    const result = await generateEmbedding({
      text: query,
      tenantId,
      functionId: "search-query-embed",
    });
    embeddingVector = result.embedding;

    // Record ai_usage row for cost tracking (REQ-11-07).
    // Use the real token count from the AI SDK when available; fall back to 0
    // only if the SDK did not report usage. completionTokens is always 0 for
    // embeddings. Failure is swallowed inside recordAiUsage — does not affect search.
    await recordAiUsage(tx, {
      tenantId,
      feature: "search_embed",
      model: result.model,
      promptTokens: result.promptTokens ?? 0,
      completionTokens: 0,
      costUsd: EMBEDDING_COST_USD,
    });
  } catch (err) {
    throw new EmbeddingFailedError(err);
  }

  const hasSubjectFilter = filters?.subjects && filters.subjects.length > 0;
  const hasLanguageFilter = typeof filters?.language === "string";
  const hasYearFromFilter = typeof filters?.yearFrom === "number";
  const hasYearToFilter = typeof filters?.yearTo === "number";
  const availabilityFilter = filters?.availability;

  // Vector literal string for Postgres: "[0.1, 0.2, ...]"
  const vectorLiteral = `[${embeddingVector.join(",")}]`;

  // ANN query: cosine distance (<=> operator). Lower distance = more similar.
  // Cosine similarity = 1 - distance; we filter distance < (1 - MIN_COSINE_SIMILARITY).
  const maxDistance = 1 - MIN_COSINE_SIMILARITY;

  const rows = await tx.execute<SemanticRow>(sql`
    SELECT
      be.book_id,
      (be.embedding <=> ${vectorLiteral}::vector) AS distance
    FROM book_embeddings be
    JOIN books b ON b.id = be.book_id
    WHERE
      be.model_version = ${EMBEDDING_MODEL_VERSION}
      AND b.deleted_at IS NULL
      AND (be.embedding <=> ${vectorLiteral}::vector) <= ${maxDistance}
      ${hasSubjectFilter ? sql`AND b.subjects && ${filters?.subjects}::text[]` : sql``}
      ${hasLanguageFilter ? sql`AND b.language = ${filters?.language}` : sql``}
      ${hasYearFromFilter ? sql`AND b.year >= ${filters?.yearFrom}` : sql``}
      ${hasYearToFilter ? sql`AND b.year <= ${filters?.yearTo}` : sql``}
      ${availabilityFilter === "on_loan" ? sql`AND EXISTS (SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL)` : sql``}
      ${availabilityFilter === "in_stock" ? sql`AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL)` : sql``}
    ORDER BY distance ASC
    LIMIT 50
  `);

  const map = new Map<string, number>();
  rows.rows.forEach((row, index) => {
    map.set(row.book_id, index + 1);
  });
  return map;
}
