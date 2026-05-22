/**
 * search_catalog tool — hybrid-searches the tenant's book catalog.
 *
 * Each tool invocation opens its own withTenantTx because the streaming
 * response outlives any single transaction.
 */

import type { TenantCtx } from "@/lib/db/with-tenant-tx";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { hybridSearch } from "@/lib/domain/search/hybrid-search";
import { tool, zodSchema } from "ai";
import { z } from "zod";

export interface CatalogBookCard {
  book_id: string;
  title: string;
  authors: string[];
  year: number | null;
  coverUrl: string | null;
}

const SearchCatalogArgsSchema = z.object({
  q: z.string().min(1).describe("The search query"),
  top_k: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("Maximum number of results to return (1–10)"),
});

type SearchCatalogArgs = z.infer<typeof SearchCatalogArgsSchema>;

export const searchCatalogTool = (ctx: TenantCtx) =>
  tool<SearchCatalogArgs, CatalogBookCard[]>({
    description:
      "Search this library's book catalog. Call this before recommending any book. Returns a ranked list of matching books.",
    inputSchema: zodSchema(SearchCatalogArgsSchema),
    execute: async ({ q, top_k }): Promise<CatalogBookCard[]> => {
      const response = await withTenantTx(ctx, (tx, tenantCtx) =>
        hybridSearch(tx, tenantCtx, {
          query: q,
          limit: top_k,
          mode: "authenticated",
        }),
      );

      return response.results.slice(0, top_k).map((r) => ({
        book_id: r.bookId,
        title: r.title,
        authors: r.authors,
        year: r.year,
        coverUrl: r.coverUrl,
      }));
    },
  });
