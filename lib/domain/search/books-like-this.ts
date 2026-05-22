/**
 * books-like-this — vector-neighbours query for the "Books like this" rail (REQ-05-05).
 *
 * Given a source bookId, fetches its embedding and runs an ANN query for the
 * 6 nearest neighbours (by cosine similarity) excluding the source book and
 * soft-deleted books.
 *
 * Returns an empty array if:
 *   - AI_SEARCH_ENABLED is not "true"
 *   - The source book has no embedding row yet
 */

import type { BookId } from "@/lib/db/schema/_shared";
import { EMBEDDING_MODEL_VERSION, bookEmbeddings } from "@/lib/db/schema/book-embeddings";
import { books } from "@/lib/db/schema/books";
import type { BookRow } from "@/lib/db/schema/books";
import type { TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, isNull, sql } from "drizzle-orm";

const BOOKS_LIKE_THIS_LIMIT = 6;

/**
 * Returns up to 6 books similar to the given source book by cosine similarity.
 *
 * @param tx       - Active tenant-scoped transaction.
 * @param bookId   - The source book's UUID.
 * @returns        Array of BookRow for similar books (empty if no embedding exists).
 */
export async function booksLikeThis(tx: TxClient, bookId: BookId): Promise<BookRow[]> {
  if (process.env.AI_SEARCH_ENABLED !== "true") {
    return [];
  }

  // Fetch the source book's embedding vector
  const sourceRows = await tx
    .select({ embedding: bookEmbeddings.embedding })
    .from(bookEmbeddings)
    .where(
      and(
        eq(bookEmbeddings.bookId, bookId),
        eq(bookEmbeddings.modelVersion, EMBEDDING_MODEL_VERSION),
      ),
    )
    .limit(1);

  const sourceEmbedding = sourceRows[0];
  if (!sourceEmbedding) {
    // No embedding for this book yet — return empty (indexed asynchronously)
    return [];
  }

  // Build ANN query using the source embedding
  // The embedding column is a Drizzle vector type; we need to serialize it.
  // biome-ignore lint/suspicious/noExplicitAny: pgvector embedding is stored as number[]
  const embeddingArray = sourceEmbedding.embedding as any as number[];
  const vectorLiteral = `[${embeddingArray.join(",")}]`;

  // ANN: find 7 nearest (including self), then exclude source, result = up to 6
  interface AnnRow extends Record<string, unknown> {
    book_id: string;
  }

  const annRows = await tx.execute<AnnRow>(sql`
    SELECT be.book_id
    FROM book_embeddings be
    JOIN books b ON b.id = be.book_id
    WHERE
      be.model_version = ${EMBEDDING_MODEL_VERSION}
      AND be.book_id != ${bookId}::uuid
      AND b.deleted_at IS NULL
    ORDER BY be.embedding <=> ${vectorLiteral}::vector ASC
    LIMIT ${BOOKS_LIKE_THIS_LIMIT}
  `);

  if (annRows.rows.length === 0) return [];

  const similarBookIds = annRows.rows.map((r) => r.book_id);

  // Fetch full book rows (preserving the ANN order is not critical for UI)
  const result = await tx
    .select()
    .from(books)
    .where(and(sql`${books.id} = ANY(${similarBookIds}::uuid[])`, isNull(books.deletedAt)));

  // Preserve the ANN distance order
  const bookMap = new Map(result.map((b) => [b.id, b]));
  return similarBookIds.map((id) => bookMap.get(id)).filter((b): b is BookRow => b !== undefined);
}
