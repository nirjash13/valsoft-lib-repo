/**
 * get_book_detail tool — fetches full metadata for a single book.
 *
 * Returns a structured "not found" instead of throwing so the model can
 * react gracefully (e.g. suggest a catalog search instead).
 */

import type { TenantCtx } from "@/lib/db/with-tenant-tx";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { BookNotFoundError } from "@/lib/domain/books/errors";
import { getBook } from "@/lib/domain/books/get-book";
import { tool, zodSchema } from "ai";
import { z } from "zod";

export type BookDetailResult =
  | {
      found: true;
      book_id: string;
      title: string;
      authors: string[];
      year: number | null;
      publisher: string | null;
      subjects: string[] | null;
      language: string | null;
      description: string | null;
      coverUrl: string | null;
    }
  | { found: false };

const GetBookDetailArgsSchema = z.object({
  book_id: z.string().uuid().describe("The book UUID"),
});

type GetBookDetailArgs = z.infer<typeof GetBookDetailArgsSchema>;

export const getBookDetailTool = (ctx: TenantCtx) =>
  tool<GetBookDetailArgs, BookDetailResult>({
    description:
      "Fetch full details for a specific book by its ID. Use the book_id returned by search_catalog.",
    inputSchema: zodSchema(GetBookDetailArgsSchema),
    execute: async ({ book_id }): Promise<BookDetailResult> => {
      try {
        const book = await withTenantTx(ctx, (tx) => getBook(tx, book_id));
        return {
          found: true,
          book_id: book.id,
          title: book.title,
          authors: book.authors,
          year: book.year,
          publisher: book.publisher ?? null,
          subjects: book.subjects ?? null,
          language: book.language ?? null,
          description: book.description ?? null,
          coverUrl: book.coverUrl ?? null,
        };
      } catch (err) {
        if (err instanceof BookNotFoundError) {
          return { found: false };
        }
        throw err;
      }
    },
  });
