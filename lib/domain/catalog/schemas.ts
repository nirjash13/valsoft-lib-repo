/**
 * Zod schemas for the public catalog domain (Spec 09).
 *
 * Single source of truth for public catalog input validation used at:
 *   1. app/api/catalog/[tenant]/books/route.ts — query string parse
 *   2. lib/domain/catalog/service.ts — internal validation
 *
 * Security: the output shapes (PublicBook, PublicBookDetail) explicitly
 * exclude any member, loan-member, hold-member, or audit fields (REQ-09-07).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// PublicBookListInput — query string parameters for the book list endpoint
// ---------------------------------------------------------------------------

export const PublicBookListInputSchema = z.object({
  /** Optional search query — lexical only (REQ-09-03, no LLM). */
  q: z.string().max(500).optional(),

  /** Page size. Defaults to 20; max 50. */
  limit: z.coerce.number().int().min(1).max(50).default(20),

  /** Offset for pagination. Defaults to 0. */
  offset: z.coerce.number().int().min(0).default(0),

  /** Filter to books with one of these subjects (comma-separated in URL). */
  subjects: z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .optional(),

  /** ISO 639-1 language code filter. */
  language: z
    .string()
    .regex(/^[a-z]{2}$/, "Language must be ISO 639-1 (2 lowercase letters)")
    .optional(),
});

export type PublicBookListInput = z.infer<typeof PublicBookListInputSchema>;

// ---------------------------------------------------------------------------
// PublicBook — a single book in the public catalog list
// ---------------------------------------------------------------------------

/**
 * The public-facing book shape. Intentionally excludes:
 *   - custom_fields (internal)
 *   - created_at (not useful for public)
 *   - any member/loan-member/hold-member/audit data (REQ-09-07)
 *
 * Availability is aggregate-only: status, due date, hold count — no member PII.
 */
export interface PublicBook {
  id: string;
  isbn13: string | null;
  title: string;
  authors: string[];
  year: number | null;
  subjects: string[] | null;
  language: string | null;
  coverUrl: string | null;
  description: string | null;
  availability: {
    status: "available" | "on_loan";
    dueAt: string | null;
    holdCount: number;
  };
}

// ---------------------------------------------------------------------------
// PublicBookDetail — single book detail (extends PublicBook)
// ---------------------------------------------------------------------------

/**
 * Extended book detail for the single-book page. Adds publisher and pageCount
 * on top of the list shape.
 */
export interface PublicBookDetail extends PublicBook {
  publisher: string | null;
  pageCount: number | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// PublicBookListResponse — the API response shape
// ---------------------------------------------------------------------------

export interface PublicBookListResponse {
  books: PublicBook[];
  totalCount: number;
}
