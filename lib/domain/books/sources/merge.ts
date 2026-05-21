/**
 * Field-level merge of Open Library and Google Books results.
 *
 * Precedence rules (REQ-02-01 d):
 *   Open Library wins when both sources provide a value for the same field.
 *   Google Books fills in any gap where Open Library returned undefined/null.
 *
 * sourcesDiff (REQ-02-01 BDD "sources disagree"):
 *   Carries year-only disagreements. The UI can display "Other source: 2009"
 *   and let the librarian pick. Only year is diffed in Run A; title/author
 *   disagreements are deferred (they require UI disambiguation, Spec 03+).
 */

import type { BookRecord } from "../schemas";

// ---------------------------------------------------------------------------
// MergeResult
// ---------------------------------------------------------------------------

export interface SourcesDiff {
  /** Present when OL and GB have different (non-undefined) year values. */
  year?: { ol: number; gb: number };
}

export interface MergeResult {
  /** The merged BookRecord (OL wins; GB fills gaps). */
  merged: Partial<BookRecord>;
  /** Fields where the two sources disagreed. */
  sourcesDiff: SourcesDiff;
}

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

/**
 * Merges Open Library and Google Books partial records.
 *
 * @param ol - Result from Open Library (null if not found / error).
 * @param gb - Result from Google Books (null if not found / error).
 * @returns MergeResult with merged record and optional sourcesDiff.
 */
export function merge(ol: Partial<BookRecord> | null, gb: Partial<BookRecord> | null): MergeResult {
  // If both are null: empty record (spec BDD "both sources empty")
  if (!ol && !gb) {
    return { merged: {}, sourcesDiff: {} };
  }

  const olRecord = ol ?? {};
  const gbRecord = gb ?? {};

  // Build merged: OL wins, GB fills gaps.
  // exactOptionalPropertyTypes: only set a key when value is defined.
  const merged: Partial<BookRecord> = {};

  const isbn13 = olRecord.isbn13 ?? gbRecord.isbn13;
  if (isbn13) merged.isbn13 = isbn13;

  const title = olRecord.title ?? gbRecord.title;
  if (title) merged.title = title;

  const authors = olRecord.authors ?? gbRecord.authors;
  if (authors && authors.length > 0) merged.authors = authors;

  const year = olRecord.year ?? gbRecord.year;
  if (year !== undefined) merged.year = year;

  const publisher = olRecord.publisher ?? gbRecord.publisher;
  if (publisher) merged.publisher = publisher;

  const pageCount = olRecord.pageCount ?? gbRecord.pageCount;
  if (pageCount !== undefined) merged.pageCount = pageCount;

  const subjects = olRecord.subjects ?? gbRecord.subjects;
  if (subjects && subjects.length > 0) merged.subjects = subjects;

  const language = olRecord.language ?? gbRecord.language;
  if (language) merged.language = language;

  const coverUrl = olRecord.coverUrl ?? gbRecord.coverUrl;
  if (coverUrl) merged.coverUrl = coverUrl;

  const description = olRecord.description ?? gbRecord.description;
  if (description) merged.description = description;

  // Compute sourcesDiff: only populated when BOTH sides have a value that differs
  const sourcesDiff: SourcesDiff = {};

  if (
    olRecord.year !== undefined &&
    gbRecord.year !== undefined &&
    olRecord.year !== gbRecord.year
  ) {
    sourcesDiff.year = { ol: olRecord.year, gb: gbRecord.year };
  }

  return { merged, sourcesDiff };
}
