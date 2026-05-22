/**
 * book_embeddings — one row per (tenant, book, model_version).
 *
 * Stores the pgvector embedding for a book's searchable text
 * (title + authors + subjects + description). The embedding is generated
 * by lib/domain/search/embed-book.ts via the AI Gateway.
 *
 * Multi-tenancy: RLS FORCE + assert_tenant() policy enforced by migration 0008.
 *
 * Rolling model cutover (REQ-05-09): when upgrading from model v1 → v2, new
 * books get v2 embeddings; old books retain v1 until a batch re-embed completes.
 * Queries use the model_version with the most rows per tenant.
 */

import { pgTable, text, timestamp, unique, uuid, vector } from "drizzle-orm/pg-core";
import { type BookId, type Branded, type TenantId, tenantIdColumn } from "./_shared";
import { books } from "./books";

export type BookEmbeddingId = Branded<string, "BookEmbeddingId">;

export const bookEmbeddings = pgTable(
  "book_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),

    // 1536-dimensional embedding (OpenAI text-embedding-3-small)
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),

    // Model identifier + version string, e.g. "openai/text-embedding-3-small@v1"
    // Used to support rolling cutover when the model is upgraded (REQ-05-09).
    modelVersion: text("model_version").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    // One embedding per (tenant, book, model) — enables rolling cutover
    unique("book_embeddings_tenant_book_model_key").on(t.tenantId, t.bookId, t.modelVersion),
  ],
);

export type BookEmbeddingRow = typeof bookEmbeddings.$inferSelect;
export type NewBookEmbeddingRow = typeof bookEmbeddings.$inferInsert;

/**
 * The model version identifier used for the primary embedding model.
 * Update this constant when upgrading the embedding model; the old rows
 * remain until a batch re-embed job completes.
 */
export const EMBEDDING_MODEL_VERSION = "openai/text-embedding-3-small@v1" as const;

/**
 * Estimated cost per embedding call used for budget pre-check.
 * text-embedding-3-small: $0.02 / 1M tokens; ~500 tokens per book → ~$0.00001.
 * We round up to $0.0001 to account for metadata overhead.
 */
export const EMBEDDING_COST_USD = 0.0001 as const;

/**
 * Type-alias for TenantId / BookId — re-exported from _shared for convenience.
 */
export type { TenantId, BookId };
