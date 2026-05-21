/**
 * Open Library ISBN API adapter.
 *
 * Endpoint: https://openlibrary.org/api/books?bibkeys=ISBN:<isbn>&format=json&jscmd=data
 *
 * Returns null on:
 *   - HTTP 404 (book not found)
 *   - 200 with empty object body (ISBN not in OL catalog)
 *
 * Propagates on:
 *   - Network errors (no connectivity)
 *   - Non-404 HTTP errors (5xx, etc.)
 *
 * Timeout: caller-supplied AbortSignal (3 s per REQ-02-01 c).
 */

import type { BookRecord } from "../schemas";

interface OlWork {
  title?: string;
  authors?: Array<{ name?: string }>;
  publish_date?: string;
  publishers?: Array<{ name?: string }>;
  number_of_pages?: number;
  subjects?: Array<{ name?: string }>;
  languages?: Array<{ key?: string }>;
  cover?: { large?: string; medium?: string };
  excerpts?: Array<{ text?: string }>;
}

/**
 * Fetch book metadata from Open Library for a given ISBN-13.
 *
 * @param isbn13 - Validated 13-digit ISBN.
 * @param signal - AbortSignal for the 3-second timeout.
 * @returns Partial BookRecord or null if not found.
 */
export async function fetchFromOpenLibrary(
  isbn13: string,
  signal: AbortSignal,
): Promise<Partial<BookRecord> | null> {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`;

  const response = await fetch(url, { signal });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Open Library returned HTTP ${response.status} for ISBN ${isbn13}`);
  }

  const json = (await response.json()) as Record<string, OlWork>;
  const key = `ISBN:${isbn13}`;
  const data = json[key];

  // OL returns an empty object `{}` for ISBN not in catalog.
  if (!data) return null;

  const year = parseYear(data.publish_date);

  // Raw cover URL from OL may be HTTP. Spec §7: block HTTP cover URLs.
  const rawCover = data.cover?.large ?? data.cover?.medium;
  const coverUrl = rawCover?.startsWith("https://") ? rawCover : undefined;

  // Build the partial record strictly — with exactOptionalPropertyTypes, we cannot
  // set a key to `undefined` if the type is `string?` (truly optional). We must omit
  // the key entirely when the value is absent.
  const partial: Partial<BookRecord> = { isbn13 };
  const title = data.title?.slice(0, 300);
  if (title) partial.title = title;
  const authors = extractStringList(data.authors?.map((a) => a.name) ?? []).slice(0, 20);
  if (authors.length > 0) partial.authors = authors;
  if (year !== undefined) partial.year = year;
  const publisher = extractFirstString(data.publishers?.map((p) => p.name) ?? [])?.slice(0, 200);
  if (publisher) partial.publisher = publisher;
  const pageCount = clampPageCount(data.number_of_pages);
  if (pageCount !== undefined) partial.pageCount = pageCount;
  const subjects = extractStringList(data.subjects?.map((s) => s.name) ?? []);
  if (subjects.length > 0) partial.subjects = subjects;
  const language = extractLanguage(data.languages);
  if (language) partial.language = language;
  if (coverUrl) partial.coverUrl = coverUrl;
  const description = data.excerpts?.[0]?.text?.slice(0, 4000);
  if (description) partial.description = description;

  return partial;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseYear(publishDate: string | undefined): number | undefined {
  if (!publishDate) return undefined;
  const match = publishDate.match(/\b(\d{4})\b/);
  if (!match) return undefined;
  const y = Number(match[1]);
  return Number.isFinite(y) && y >= 1450 && y <= new Date().getFullYear() + 1 ? y : undefined;
}

function extractStringList(raw: Array<string | undefined | null>): string[] {
  return raw.map((s) => (typeof s === "string" ? s.trim() : "")).filter((s) => s.length > 0);
}

function extractFirstString(raw: Array<string | undefined | null>): string | undefined {
  return extractStringList(raw)[0];
}

function clampPageCount(n: number | undefined): number | undefined {
  if (n == null || !Number.isInteger(n)) return undefined;
  return n >= 1 && n <= 10000 ? n : undefined;
}

function extractLanguage(langs: Array<{ key?: string }> | undefined): string | undefined {
  // OL uses "/languages/eng" style keys
  const raw = langs?.[0]?.key;
  if (!raw) return undefined;
  const code = raw.split("/").at(-1);
  // Normalize: ISO 639-2/B (3-char) isn't our schema's 2-char ISO 639-1.
  // Map common OL codes; otherwise omit to avoid invalid data.
  const map: Record<string, string> = {
    eng: "en",
    fre: "fr",
    ger: "de",
    spa: "es",
    por: "pt",
    ita: "it",
    dut: "nl",
    jpn: "ja",
    zho: "zh",
    ara: "ar",
    rus: "ru",
    kor: "ko",
  };
  return code ? (map[code] ?? undefined) : undefined;
}
