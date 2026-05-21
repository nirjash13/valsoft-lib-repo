/**
 * Google Books API adapter.
 *
 * Endpoint: https://www.googleapis.com/books/v1/volumes?q=isbn:<isbn>
 *
 * Returns null on:
 *   - 200 with `totalItems: 0` (ISBN not found in Google Books)
 *
 * Propagates on:
 *   - Network errors
 *   - Non-429 / non-200 HTTP errors
 *
 * Degrades silently on:
 *   - 429 Too Many Requests — returns null (treat as "not found") per spec §7
 *     "on 429, degrade silently to Open Library only"
 *
 * Timeout: caller-supplied AbortSignal (3 s per REQ-02-01 c).
 */

import type { BookRecord } from "../schemas";

interface GbVolumeInfo {
  title?: string;
  authors?: string[];
  publishedDate?: string;
  publisher?: string;
  pageCount?: number;
  categories?: string[];
  language?: string;
  imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  description?: string;
}

interface GbVolume {
  volumeInfo?: GbVolumeInfo;
}

interface GbResponse {
  totalItems?: number;
  items?: GbVolume[];
}

/**
 * Fetch book metadata from Google Books for a given ISBN-13.
 *
 * @param isbn13 - Validated 13-digit ISBN.
 * @param signal - AbortSignal for the 3-second timeout.
 * @returns Partial BookRecord or null if not found / 429.
 */
export async function fetchFromGoogleBooks(
  isbn13: string,
  signal: AbortSignal,
): Promise<Partial<BookRecord> | null> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`;

  const response = await fetch(url, { signal });

  // 429: rate-limited — degrade silently (spec §7)
  if (response.status === 429) return null;

  if (!response.ok) {
    throw new Error(`Google Books returned HTTP ${response.status} for ISBN ${isbn13}`);
  }

  const json = (await response.json()) as GbResponse;

  // Google Books 200 with `totalItems: 0` = not found
  if (!json.totalItems || json.totalItems === 0 || !json.items?.[0]) return null;

  const info = json.items[0].volumeInfo;
  if (!info) return null;

  const year = parseYear(info.publishedDate);

  // Spec §7: block HTTP cover URLs
  const rawCover = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;
  const coverUrl = rawCover?.startsWith("https://") ? rawCover : undefined;

  // Build the partial record strictly — with exactOptionalPropertyTypes, we cannot
  // set a key to `undefined` if the type is `string?` (truly optional). We must omit
  // the key entirely when the value is absent.
  const partial: Partial<BookRecord> = { isbn13 };
  const title = info.title?.slice(0, 300);
  if (title) partial.title = title;
  const authors = (info.authors ?? []).slice(0, 20);
  if (authors.length > 0) partial.authors = authors;
  if (year !== undefined) partial.year = year;
  const publisher = info.publisher?.slice(0, 200);
  if (publisher) partial.publisher = publisher;
  const pageCount = clampPageCount(info.pageCount);
  if (pageCount !== undefined) partial.pageCount = pageCount;
  if (info.categories && info.categories.length > 0) partial.subjects = info.categories;
  const language = normalizeLang(info.language);
  if (language) partial.language = language;
  if (coverUrl) partial.coverUrl = coverUrl;
  const description = info.description?.slice(0, 4000);
  if (description) partial.description = description;

  return partial;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseYear(publishedDate: string | undefined): number | undefined {
  if (!publishedDate) return undefined;
  const match = publishedDate.match(/^(\d{4})/);
  if (!match) return undefined;
  const y = Number(match[1]);
  return Number.isFinite(y) && y >= 1450 && y <= new Date().getFullYear() + 1 ? y : undefined;
}

function clampPageCount(n: number | undefined): number | undefined {
  if (n == null || !Number.isInteger(n)) return undefined;
  return n >= 1 && n <= 10000 ? n : undefined;
}

/**
 * Google Books uses ISO 639-1 codes already (e.g., "en", "fr").
 * Validate format; reject anything not 2 lowercase letters.
 */
function normalizeLang(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  return /^[a-z]{2}$/.test(lang) ? lang : undefined;
}
