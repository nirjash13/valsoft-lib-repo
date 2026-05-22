/**
 * Public catalog service — read-only queries for the public browse surface (Spec 09).
 *
 * All functions in this module:
 *   - Read from `reporting.public_books` (view, no PII — REQ-09-02, REQ-09-07)
 *   - Apply application-level subject blocklist filtering (defense-in-depth — REQ-09-06)
 *   - Use lexical-only search (no LLM, no embedding — REQ-09-03, NFR-09-02)
 *   - Accept a TxClient from withSystemTenantTx (tenant-scoped, no session)
 *
 * No `next/*`, no `@auth0/*`, no AI SDK imports — pure TS domain module.
 */

import type { TxClient } from "@/lib/db/with-tenant-tx";
import { type SQL, sql } from "drizzle-orm";
import { PublicBookNotFoundError } from "./errors";
import type {
  PublicBook,
  PublicBookDetail,
  PublicBookListInput,
  PublicBookListResponse,
} from "./schemas";

// ---------------------------------------------------------------------------
// Raw row types from the reporting.public_books view
// ---------------------------------------------------------------------------

interface PublicBookRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  isbn13: string | null;
  title: string;
  authors: string[];
  year: number | null;
  publisher: string | null;
  page_count: number | null;
  subjects: string[] | null;
  language: string | null;
  cover_url: string | null;
  description: string | null;
  updated_at: string;
  availability_status: string;
  loan_due_at: string | null;
  hold_count: number;
}

interface CountRow extends Record<string, unknown> {
  count: number;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toPublicBook(row: PublicBookRow): PublicBook {
  return {
    id: row.id,
    isbn13: row.isbn13,
    title: row.title,
    authors: row.authors,
    year: row.year,
    subjects: row.subjects,
    language: row.language,
    coverUrl: row.cover_url,
    description: row.description,
    availability: {
      status: row.availability_status === "on_loan" ? "on_loan" : "available",
      dueAt: row.loan_due_at,
      holdCount: row.hold_count,
    },
  };
}

function toPublicBookDetail(row: PublicBookRow): PublicBookDetail {
  return {
    ...toPublicBook(row),
    publisher: row.publisher,
    pageCount: row.page_count,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Application-level blocklist check (defense-in-depth — REQ-09-06)
// ---------------------------------------------------------------------------

/**
 * Returns true if any of the book's subjects appear in the blocklist.
 * This is the application-layer mirror of the DB-view exclusion.
 */
function isBlockedBySubjects(bookSubjects: string[] | null, blocklist: readonly string[]): boolean {
  if (!bookSubjects || bookSubjects.length === 0 || blocklist.length === 0) {
    return false;
  }
  const blocked = new Set(blocklist);
  return bookSubjects.some((s) => blocked.has(s));
}

// ---------------------------------------------------------------------------
// listPublicBooks
// ---------------------------------------------------------------------------

/**
 * Returns a paginated list of public catalog books.
 *
 * Search (if `input.q` is provided) uses lexical-only tsvector matching
 * (REQ-09-03, REQ-05-10). No embedding, no LLM call.
 *
 * @param tx               - Active tenant-scoped transaction (via withSystemTenantTx).
 * @param input            - Validated query parameters.
 * @param subjectBlocklist - Tenant's subject blocklist for defense-in-depth.
 */
export async function listPublicBooks(
  tx: TxClient,
  input: PublicBookListInput,
  subjectBlocklist: readonly string[],
): Promise<PublicBookListResponse> {
  const { q, limit, offset, subjects, language } = input;

  const hasSearch = typeof q === "string" && q.trim().length > 0;
  const hasSubjectFilter = subjects && subjects.length > 0;
  const hasLanguageFilter = typeof language === "string";

  // Build the query dynamically based on filters.
  // All values are parameterized via Drizzle's sql template — no raw interpolation.
  const baseView = sql.raw("reporting.public_books");

  // For search: join with the books table tsvector (REQ-09-03).
  // The view already filters deleted + blocklisted books; search narrows further.
  let dataQuery: SQL;
  let countQuery: SQL;

  if (hasSearch) {
    const sanitized = q?.replace(/'/g, " ").trim() ?? "";

    dataQuery = sql`
      SELECT pb.*
      FROM ${baseView} pb
      JOIN public.books b ON b.id = pb.id
      WHERE b.tsv @@ websearch_to_tsquery('english', ${sanitized})
        ${hasSubjectFilter ? sql`AND pb.subjects && ${subjects}::text[]` : sql``}
        ${hasLanguageFilter ? sql`AND pb.language = ${language}` : sql``}
      ORDER BY ts_rank_cd(b.tsv, websearch_to_tsquery('english', ${sanitized}), 32) DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    countQuery = sql`
      SELECT COUNT(*)::int AS count
      FROM ${baseView} pb
      JOIN public.books b ON b.id = pb.id
      WHERE b.tsv @@ websearch_to_tsquery('english', ${sanitized})
        ${hasSubjectFilter ? sql`AND pb.subjects && ${subjects}::text[]` : sql``}
        ${hasLanguageFilter ? sql`AND pb.language = ${language}` : sql``}
    `;
  } else {
    dataQuery = sql`
      SELECT *
      FROM ${baseView}
      WHERE true
        ${hasSubjectFilter ? sql`AND subjects && ${subjects}::text[]` : sql``}
        ${hasLanguageFilter ? sql`AND language = ${language}` : sql``}
      ORDER BY title ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    countQuery = sql`
      SELECT COUNT(*)::int AS count
      FROM ${baseView}
      WHERE true
        ${hasSubjectFilter ? sql`AND subjects && ${subjects}::text[]` : sql``}
        ${hasLanguageFilter ? sql`AND language = ${language}` : sql``}
    `;
  }

  const [dataRes, countRes] = await Promise.all([
    tx.execute<PublicBookRow>(dataQuery),
    tx.execute<CountRow>(countQuery),
  ]);

  // Application-level blocklist filter (defense-in-depth — REQ-09-06).
  // The DB view already excludes blocked books, but we double-check here.
  const books = (dataRes.rows as PublicBookRow[])
    .filter((row) => !isBlockedBySubjects(row.subjects, subjectBlocklist))
    .map(toPublicBook);

  const totalCount = (countRes.rows[0] as CountRow | undefined)?.count ?? 0;

  return { books, totalCount };
}

// ---------------------------------------------------------------------------
// getPublicBook
// ---------------------------------------------------------------------------

/**
 * Returns a single public book detail, or throws PublicBookNotFoundError.
 *
 * @param tx               - Active tenant-scoped transaction (via withSystemTenantTx).
 * @param bookId           - UUID of the book to fetch.
 * @param subjectBlocklist - Tenant's subject blocklist for defense-in-depth.
 * @throws {PublicBookNotFoundError} if book not found or blocked.
 */
export async function getPublicBook(
  tx: TxClient,
  bookId: string,
  subjectBlocklist: readonly string[],
): Promise<PublicBookDetail> {
  const result = await tx.execute<PublicBookRow>(sql`
    SELECT * FROM reporting.public_books WHERE id = ${bookId} LIMIT 1
  `);

  if (result.rows.length === 0) {
    throw new PublicBookNotFoundError(bookId);
  }

  const row = result.rows[0] as PublicBookRow;

  // Application-level blocklist check (defense-in-depth — REQ-09-06)
  if (isBlockedBySubjects(row.subjects, subjectBlocklist)) {
    throw new PublicBookNotFoundError(bookId);
  }

  return toPublicBookDetail(row);
}
