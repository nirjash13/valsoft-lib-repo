/**
 * Zod schemas for the books domain.
 *
 * Single source of truth used at three boundaries:
 *   1. Server Action input validation (next-safe-action .schema(...))
 *   2. AI tool argument schema (generateObject)
 *   3. Client form parsing (react-hook-form + zodResolver)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// BookRecord — the canonical shape of a book in Stack
// ---------------------------------------------------------------------------

const CURRENT_YEAR = new Date().getFullYear();

export const BookRecordSchema = z.object({
  isbn13: z
    .string()
    .regex(/^\d{13}$/, "ISBN-13 must be exactly 13 digits")
    .optional(),
  title: z.string().min(1, "Title is required").max(300, "Title must be 300 characters or less"),
  authors: z
    .array(z.string().min(1).max(200))
    .min(1, "At least one author is required")
    .max(20, "Maximum 20 authors"),
  year: z
    .number()
    .int()
    .min(1450, "Year must be 1450 or later")
    .max(CURRENT_YEAR + 1, `Year must be ${CURRENT_YEAR + 1} or earlier`)
    .optional(),
  publisher: z.string().min(1).max(200).optional(),
  pageCount: z.number().int().min(1).max(10000).optional(),
  subjects: z.array(z.string().min(1)).optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}$/, "Language must be ISO 639-1 (2 lowercase letters)")
    .optional(),
  coverUrl: z
    .string()
    .url("Cover URL must be a valid URL")
    .regex(/^https:\/\//, "Cover URL must use HTTPS to avoid mixed content")
    .optional(),
  description: z.string().max(4000, "Description must be 4000 characters or less").optional(),
  customFields: z
    .record(
      z.string().regex(/^[a-z_]{1,32}$/, "Custom field keys must be snake_case, max 32 chars"),
      z.string().max(500, "Custom field values must be 500 characters or less"),
    )
    .optional(),
});

export type BookRecord = z.infer<typeof BookRecordSchema>;

// ---------------------------------------------------------------------------
// CreateBookInput — input for the createBook Server Action
// ---------------------------------------------------------------------------

/**
 * Input for creating a book. Differs from BookRecord in that it accepts the
 * raw data from the preview or form. The updatedAt concurrency token is not
 * included — that only applies to updates.
 */
export const CreateBookSchema = BookRecordSchema;
export type CreateBookInput = z.infer<typeof CreateBookSchema>;

// ---------------------------------------------------------------------------
// UpdateBookInput — includes optimistic concurrency token
// ---------------------------------------------------------------------------

export const UpdateBookSchema = BookRecordSchema.extend({
  id: z.string().uuid("Book ID must be a UUID"),
  /** The updated_at timestamp the client last saw. Used for optimistic concurrency check. */
  expectedUpdatedAt: z.string().datetime("expectedUpdatedAt must be an ISO 8601 datetime"),
});

export type UpdateBookInput = z.infer<typeof UpdateBookSchema>;

// ---------------------------------------------------------------------------
// PreviewIsbnInput — input for the previewIsbn Server Action
// ---------------------------------------------------------------------------

export const PreviewIsbnSchema = z.object({
  /**
   * Raw ISBN string as the user typed it (may include dashes, spaces,
   * may be ISBN-10 or ISBN-13). Normalized by the domain function.
   */
  rawIsbn: z.string().min(1, "ISBN is required"),
});

export type PreviewIsbnInput = z.infer<typeof PreviewIsbnSchema>;

// ---------------------------------------------------------------------------
// ListBooksFilter — filter options for listBooks
// ---------------------------------------------------------------------------

export const ListBooksFilterSchema = z.object({
  query: z.string().optional(),
  includeDeleted: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(200).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type ListBooksFilter = z.infer<typeof ListBooksFilterSchema>;

// ---------------------------------------------------------------------------
// SoftDeleteBookInput / RestoreBookInput
// ---------------------------------------------------------------------------

export const SoftDeleteBookSchema = z.object({
  id: z.string().uuid("Book ID must be a UUID"),
});
export type SoftDeleteBookInput = z.infer<typeof SoftDeleteBookSchema>;

export const RestoreBookSchema = z.object({
  id: z.string().uuid("Book ID must be a UUID"),
});
export type RestoreBookInput = z.infer<typeof RestoreBookSchema>;
