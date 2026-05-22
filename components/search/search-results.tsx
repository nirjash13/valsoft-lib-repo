import { Badge } from "@/components/ui/badge";
import type { SearchResult } from "@/lib/domain/search/schemas";
import { coverGradient } from "@/lib/utils/cover-color";
import Image from "next/image";
import Link from "next/link";
import { LoadMoreButton } from "./load-more-button";

// FOLLOW-UP-05B: ts_headline highlighting — Run A did not implement ts_headline
// snippet fragments in the SearchResult type. When Run A adds a `snippet` field
// to SearchResult, replace the description plain-text below with highlighted HTML.

interface SearchResultsProps {
  results: SearchResult[];
  cursor: string | undefined;
  totalCount: number;
  /** The current search URL with all active params (for "Load more" link). */
  searchHref: string;
}

/**
 * Ranked search result list. Each result links to /books/[id].
 * Cursor-based "Load more" appends the next page via URL update.
 */
export function SearchResults({ results, cursor, totalCount, searchHref }: SearchResultsProps) {
  if (results.length === 0) return null;

  return (
    <section aria-label={`${totalCount} search result${totalCount !== 1 ? "s" : ""}`}>
      <p className="text-meta text-text-tertiary mb-4" aria-live="polite">
        {totalCount} result{totalCount !== 1 ? "s" : ""}
      </p>

      <ul className="flex flex-col divide-y divide-border-subtle list-none m-0 p-0 rounded-xl border border-border-subtle overflow-hidden">
        {results.map((result) => (
          <ResultRow key={result.bookId} result={result} />
        ))}
      </ul>

      {cursor && (
        <div className="mt-6 flex justify-center">
          <LoadMoreButton cursor={cursor} searchHref={searchHref} />
        </div>
      )}
    </section>
  );
}

function ResultRow({ result }: { result: SearchResult }) {
  const gradient = coverGradient(result.title);
  const primaryAuthor = result.authors[0] ?? "Unknown Author";
  const authorDisplay =
    result.authors.length > 1 ? `${primaryAuthor} +${result.authors.length - 1}` : primaryAuthor;

  return (
    <li className="bg-surface hover:bg-elevated transition-instant transition-colors">
      <Link
        href={`/books/${result.bookId}`}
        className="flex gap-4 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        {/* Mini cover */}
        <div
          className="relative shrink-0 rounded-md overflow-hidden"
          style={{ width: 48, height: 64 }}
          aria-hidden
        >
          {result.coverUrl ? (
            <Image
              src={result.coverUrl}
              alt={`Cover of ${result.title}`}
              fill
              sizes="48px"
              className="object-cover"
            />
          ) : (
            <div
              className="absolute inset-0 flex flex-col justify-end p-1.5"
              style={{ background: gradient }}
            >
              <p className="text-[10px] text-white/90 font-semibold line-clamp-3 leading-tight">
                {result.title}
              </p>
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          <h3 className="text-body font-semibold text-text-primary line-clamp-1 leading-snug">
            {result.title}
          </h3>

          <p className="text-meta text-text-secondary line-clamp-1">{authorDisplay}</p>

          {/* Snippet / description */}
          {result.description && (
            <p className="text-meta text-text-tertiary line-clamp-2 mt-0.5">{result.description}</p>
          )}

          {/* Subject chips */}
          {result.subjects && result.subjects.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {result.subjects.slice(0, 4).map((subject) => (
                <span
                  key={subject}
                  className="inline-block rounded-full bg-surface-2 px-2 py-0.5 text-caption text-text-tertiary border border-border-subtle"
                >
                  {subject}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right side: year + availability */}
        <div className="shrink-0 flex flex-col items-end justify-center gap-2 ml-2">
          {result.year && (
            <span className="text-meta text-text-tertiary tabular-nums">{result.year}</span>
          )}
          <AvailabilityBadge deletedAt={result.deletedAt} />
        </div>
      </Link>
    </li>
  );
}

function AvailabilityBadge({ deletedAt }: { deletedAt: Date | null }) {
  // NOTE: The search domain returns availability from the RRF fusion;
  // we use deletedAt as a proxy here. A dedicated availability field
  // (from the loans join) would be a FOLLOW-UP-05B enhancement.
  if (deletedAt !== null) {
    return <Badge variant="warning">Deleted</Badge>;
  }
  // Without a per-row availability signal in SearchResult, we omit the badge
  // to avoid false positives. The facet sidebar provides aggregate availability.
  return null;
}
