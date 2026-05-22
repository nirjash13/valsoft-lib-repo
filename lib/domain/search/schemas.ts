/**
 * Zod schemas for the search domain (Spec 05).
 *
 * Single source of truth for search input validation used at:
 *   1. app/api/search/route.ts Route Handler body parse
 *   2. lib/domain/search/hybrid-search.ts internal validation
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// SearchFilters — optional facet filters applied before RRF
// ---------------------------------------------------------------------------

export const SearchFiltersSchema = z.object({
  /** Filter to books with one of these subjects */
  subjects: z.array(z.string().min(1)).optional(),
  /** ISO 639-1 language code filter */
  language: z
    .string()
    .regex(/^[a-z]{2}$/, "Language must be ISO 639-1 (2 lowercase letters)")
    .optional(),
  /** Availability filter */
  availability: z.enum(["in_stock", "on_loan"]).optional(),
  /** Publication year range — from (inclusive) */
  yearFrom: z.number().int().min(1450).max(2100).optional(),
  /** Publication year range — to (inclusive) */
  yearTo: z.number().int().min(1450).max(2100).optional(),
});

export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

// ---------------------------------------------------------------------------
// SearchInput — the POST body accepted by app/api/search/route.ts
// ---------------------------------------------------------------------------

export const SearchInputSchema = z.object({
  /** The user's raw search query (1–500 chars). */
  query: z.string().min(1, "Query must be at least 1 character").max(500, "Query too long"),

  /** Optional facet filters applied before RRF fusion. */
  filters: SearchFiltersSchema.optional(),

  /**
   * Opaque cursor token for pagination. Encodes the last RRF score + book_id
   * tiebreaker. Undefined on the first page.
   */
  cursor: z.string().optional(),

  /** Page size. Defaults to 20; max 50 (REQ-05-01 cap). */
  limit: z.number().int().min(1).max(50).default(20),

  /**
   * Search mode — used to support the public catalog (Spec 09, REQ-05-10).
   * 'authenticated' (default): full hybrid search with semantic.
   * 'public_lexical_only': skips embedding call; returns lexical-only results.
   * Spec 09 will call hybrid search with mode='public_lexical_only'; this spec
   * implements the plumbing so that Run B / Spec 09 need no refactoring.
   */
  mode: z.enum(["authenticated", "public_lexical_only"]).default("authenticated"),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

// ---------------------------------------------------------------------------
// SearchResult — a single book in the ranked result list
// ---------------------------------------------------------------------------

export const SearchResultSchema = z.object({
  bookId: z.string().uuid(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  language: z.string().nullable(),
  subjects: z.array(z.string()).nullable(),
  coverUrl: z.string().nullable(),
  description: z.string().nullable(),
  deletedAt: z.date().nullable(),
  /** RRF fusion score — higher is more relevant. */
  score: z.number(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

// ---------------------------------------------------------------------------
// Facets — computed from the candidate result set (REQ-05-06)
// ---------------------------------------------------------------------------

export interface FacetBucket {
  value: string;
  count: number;
}

export interface YearBucket {
  decade: number;
  count: number;
}

export interface Facets {
  subjects: FacetBucket[];
  languages: FacetBucket[];
  availability: {
    inStock: number;
    onLoan: number;
  };
  yearBuckets: YearBucket[];
}

// ---------------------------------------------------------------------------
// SearchResponse — returned by hybridSearch and the Route Handler
// ---------------------------------------------------------------------------

export interface SearchResponse {
  results: SearchResult[];
  facets: Facets;
  totalCount: number;
  /** Cursor for the next page. Undefined when there are no more results. */
  cursor: string | undefined;
}
