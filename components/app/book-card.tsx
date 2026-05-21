import type { BookRow } from "@/lib/db/schema/books";
import { cn } from "@/lib/utils/cn";
import { coverGradient } from "@/lib/utils/cover-color";
import Image from "next/image";
import Link from "next/link";

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
  const gradient = coverGradient(book.title);
  const primaryAuthor = book.authors[0] ?? "Unknown Author";
  const authorDisplay =
    book.authors.length > 1 ? `${primaryAuthor} +${book.authors.length - 1}` : primaryAuthor;

  return (
    <Link
      href={`/books/${book.id}`}
      className={cn(
        "group flex flex-col rounded-xl overflow-hidden",
        "bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border-subtle))]",
        "elev-1 transition-standard transition-all",
        "hover:border-[hsl(var(--border-default))] hover:elev-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg-canvas))]",
      )}
    >
      {/* Cover — 3:4 aspect ratio */}
      <div className="relative w-full" style={{ aspectRatio: "3/4" }} aria-hidden>
        {book.coverUrl ? (
          <Image
            src={book.coverUrl}
            alt={`Cover of ${book.title}`}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 200px"
            className="object-cover"
            onError={() => {
              // Next.js Image handles broken URLs — falls through to the gradient below
            }}
          />
        ) : (
          // Typographic fallback cover (brief §design questions #3)
          <div
            className="absolute inset-0 flex flex-col justify-end p-3"
            style={{ background: gradient }}
          >
            <p className="text-caption text-white/90 font-semibold line-clamp-3 leading-tight">
              {book.title}
            </p>
            <p className="text-[11px] text-white/60 mt-1 line-clamp-1 leading-tight">
              {primaryAuthor}
            </p>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="flex flex-col gap-1 p-3">
        <h3 className="text-meta font-semibold text-[hsl(var(--text-primary))] line-clamp-2 leading-snug group-hover:text-[hsl(var(--accent))] transition-instant transition-colors">
          {book.title}
        </h3>
        <p className="text-[12px] text-[hsl(var(--text-secondary))] line-clamp-1">
          {authorDisplay}
        </p>
        {book.year && <p className="text-[11px] text-[hsl(var(--text-tertiary))]">{book.year}</p>}
      </div>
    </Link>
  );
}

/**
 * BookCardSkeleton — loading placeholder matching the BookCard dimensions.
 */
export function BookCardSkeleton() {
  return (
    <div className="flex flex-col rounded-xl overflow-hidden bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border-subtle))] elev-1">
      <div
        className="w-full animate-pulse bg-[hsl(var(--bg-surface-2))]"
        style={{ aspectRatio: "3/4" }}
      />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-3 w-3/4 rounded bg-[hsl(var(--bg-surface-2))] animate-pulse" />
        <div className="h-3 w-1/2 rounded bg-[hsl(var(--bg-surface-2))] animate-pulse" />
      </div>
    </div>
  );
}
