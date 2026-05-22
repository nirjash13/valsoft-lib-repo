import type { BookRow } from "@/lib/db/schema/books";
import { cn } from "@/lib/utils/cn";
import Link from "next/link";
import { BookCover } from "./book-cover";

interface BookCardProps {
  book: BookRow;
}

/**
 * BookCard — 3:4 cover thumbnail, title, author(s), status badge.
 *
 * Cover fallback (brief §Open design questions #3): a typographic gradient with
 * title + author text — never a broken-image placeholder.
 */
export function BookCard({ book }: BookCardProps) {
  const primaryAuthor = book.authors[0] ?? "Unknown Author";
  const authorDisplay =
    book.authors.length > 1 ? `${primaryAuthor} +${book.authors.length - 1}` : primaryAuthor;

  return (
    <Link
      href={`/books/${book.id}`}
      className={cn(
        "group flex flex-col rounded-xl overflow-hidden",
        "bg-surface border border-border-subtle",
        "elev-1 transition-standard transition-all",
        "hover:border-border-default hover:elev-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
      )}
    >
      {/* Cover — 3:4 aspect ratio */}
      <div className="relative w-full" style={{ aspectRatio: "3/4" }} aria-hidden>
        <BookCover coverUrl={book.coverUrl} title={book.title} primaryAuthor={primaryAuthor} />
      </div>

      {/* Metadata */}
      <div className="flex flex-col gap-1 p-3">
        <h3 className="text-meta font-semibold text-text-primary line-clamp-2 leading-snug group-hover:text-accent transition-instant transition-colors">
          {book.title}
        </h3>
        {/* REVIEW: text-[12px] — below text-meta(13px); text-caption adds uppercase which changes appearance */}
        <p className="text-[12px] text-text-secondary line-clamp-1">{authorDisplay}</p>
        {/* REVIEW: text-[11px] — below 12px floor per design brief; safe to remove if year display is dropped */}
        {book.year && <p className="text-[11px] text-text-tertiary">{book.year}</p>}
      </div>
    </Link>
  );
}

/**
 * BookCardSkeleton — loading placeholder matching the BookCard dimensions.
 */
export function BookCardSkeleton() {
  return (
    <div className="flex flex-col rounded-xl overflow-hidden bg-surface border border-border-subtle elev-1">
      <div className="w-full animate-pulse bg-surface-2" style={{ aspectRatio: "3/4" }} />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-3 w-3/4 rounded bg-surface-2 animate-pulse" />
        <div className="h-3 w-1/2 rounded bg-surface-2 animate-pulse" />
      </div>
    </div>
  );
}
