/**
 * embed-book — generates and UPSERTs a book embedding (REQ-05-03).
 *
 * Called after book.created, book.updated (when searchable fields change),
 * and book.restored. Idempotent: uses ON CONFLICT DO UPDATE so repeated calls
 * are safe and will refresh the embedding if the book content has changed.
 *
 * Cost: ~$0.0001 per book. Budget pre-check is done via assertAiBudget before
 * every generateEmbedding call.
 *
 * The tsv column (Postgres GENERATED ALWAYS AS STORED) is maintained by the DB
 * engine automatically — this function only handles the pgvector embedding.
 */

import { assertAiBudget } from "@/lib/ai/budget";
import { generateEmbedding } from "@/lib/ai/gateway";
import { recordAiUsage } from "@/lib/ai/usage";
import type { BookId, TenantId } from "@/lib/db/schema/_shared";
import {
  EMBEDDING_COST_USD,
  EMBEDDING_MODEL_VERSION,
  bookEmbeddings,
} from "@/lib/db/schema/book-embeddings";
import { books } from "@/lib/db/schema/books";
import type { TxClient } from "@/lib/db/with-tenant-tx";
import { eq, sql } from "drizzle-orm";
import { EmbeddingFailedError } from "./errors";

interface EmbedBookParams {
  tenantId: TenantId;
  bookId: BookId;
}

/**
 * Builds the searchable text from a book row.
 * Uses the same field weights as the tsvector GENERATED column:
 *   title (most important) + authors + subjects + description.
 */
function buildSearchableText(book: {
  title: string;
  authors: string[];
  subjects: string[] | null;
  description: string | null;
}): string {
  const parts: string[] = [book.title, book.authors.join(" ")];
  if (book.subjects && book.subjects.length > 0) {
    parts.push(book.subjects.join(" "));
  }
  if (book.description) {
    parts.push(book.description);
  }
  return parts.join(" ").trim();
}

/**
 * Generates and UPSERTs an embedding for the given book.
 *
 * Skips books with no embedding-worthy content (no title — impossible per schema,
 * but defensive). Does NOT throw on budget/AI failure during batch operations;
 * callers that need strict failure semantics should catch EmbeddingFailedError.
 *
 * @param tx     - Active tenant-scoped transaction.
 * @param params - tenantId + bookId.
 * @throws EmbeddingFailedError if the AI gateway call fails.
 */
export async function embedBook(tx: TxClient, params: EmbedBookParams): Promise<void> {
  if (process.env.AI_SEARCH_ENABLED !== "true") {
    // AI search not enabled — skip embedding silently.
    return;
  }

  // Fetch the book row within the same transaction (RLS-scoped)
  const rows = await tx
    .select({
      id: books.id,
      title: books.title,
      authors: books.authors,
      subjects: books.subjects,
      description: books.description,
    })
    .from(books)
    .where(eq(books.id, params.bookId))
    .limit(1);

  const book = rows[0];
  if (!book) {
    // Book doesn't exist in this tenant — nothing to embed.
    return;
  }

  const text = buildSearchableText(book);
  if (!text) return;

  let embedding: number[];
  try {
    await assertAiBudget(params.tenantId, EMBEDDING_COST_USD);
    const result = await generateEmbedding({
      text,
      tenantId: params.tenantId,
      functionId: "search-embed",
    });
    embedding = result.embedding;

    // Record ai_usage row for cost tracking (REQ-11-07).
    // Use the real token count from the AI SDK when available (result.promptTokens);
    // fall back to 0 only if the SDK did not report usage. completionTokens is
    // always 0 for embeddings (no output tokens).
    // Failure is swallowed inside recordAiUsage — does not affect embedding.
    await recordAiUsage(tx, {
      tenantId: params.tenantId,
      feature: "search_embed",
      model: result.model,
      promptTokens: result.promptTokens ?? 0,
      completionTokens: 0,
      costUsd: EMBEDDING_COST_USD,
    });
  } catch (err) {
    throw new EmbeddingFailedError(err);
  }

  // UPSERT: insert new row or update existing embedding + updated_at
  await tx
    .insert(bookEmbeddings)
    .values({
      tenantId: params.tenantId,
      bookId: params.bookId,
      // Drizzle doesn't have a built-in vector literal type yet; cast via SQL
      // biome-ignore lint/suspicious/noExplicitAny: pgvector array requires cast
      embedding: sql`${JSON.stringify(embedding)}::vector` as any,
      modelVersion: EMBEDDING_MODEL_VERSION,
    })
    .onConflictDoUpdate({
      target: [bookEmbeddings.tenantId, bookEmbeddings.bookId, bookEmbeddings.modelVersion],
      set: {
        // biome-ignore lint/suspicious/noExplicitAny: pgvector array requires cast
        embedding: sql`excluded.embedding` as any,
        updatedAt: new Date(),
      },
    });
}

/** Re-export for use in domain wiring. */
export { buildSearchableText };
