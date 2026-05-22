import type { PublicBook } from "@/lib/domain/catalog/schemas";
import { cn } from "@/lib/utils/cn";
import { coverGradient } from "@/lib/utils/cover-color";
import Image from "next/image";
import Link from "next/link";

interface PublicBookCardProps {
  tenantSlug: string;
  book: PublicBook;
}

/**
 * PublicBookCard — displays a single book card on the public browse grid.
 *
 * Implements REQ-09-02 (safe availability badge showing aggregate counts only).
 */
export function PublicBookCard({ tenantSlug, book }: PublicBookCardProps) {
  const gradient = coverGradient(book.title);
  const primaryAuthor = book.authors[0] ?? "Unknown Author";
  const authorDisplay =
    book.authors.length > 1 ? `${primaryAuthor} +${book.authors.length - 1}` : primaryAuthor;

  const { status, dueAt, holdCount } = book.availability;

  return (
    <Link
      href={`/${tenantSlug}/catalog/${book.id}`}
      className={cn(
        "group flex flex-col h-full rounded-xl overflow-hidden",
        "bg-surface border border-border-subtle",
        "elev-1 transition-standard transition-all",
        "hover:border-border-default hover:elev-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
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
          />
        ) : (
          // Typographic fallback cover
          <div
            className="absolute inset-0 flex flex-col justify-end p-4"
            style={{ background: gradient }}
          >
            <p className="text-h3 text-white/95 font-semibold line-clamp-3 leading-tight">
              {book.title}
            </p>
            <p className="text-meta text-white/70 mt-1.5 line-clamp-1 leading-tight">
              {primaryAuthor}
            </p>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-4 gap-2">
        <div className="flex-1">
          <h3 className="text-meta font-semibold text-text-primary line-clamp-2 leading-snug group-hover:text-accent transition-instant transition-colors">
            {book.title}
          </h3>
          <p className="text-[13px] text-text-secondary line-clamp-1 mt-1">{authorDisplay}</p>
          {book.year && <p className="text-[11px] text-text-tertiary mt-0.5">{book.year}</p>}
        </div>

        {/* Availability Badge */}
        <div className="mt-3 flex items-center justify-between">
          {status === "available" ? (
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-full text-caption font-medium",
                "bg-success/10 text-success border border-success/20",
              )}
            >
              Available
            </span>
          ) : (
            <div className="flex flex-col gap-1 items-start">
              <span
                className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded-full text-caption font-medium",
                  "bg-warning/10 text-warning border border-warning/20",
                )}
              >
                On Loan
              </span>
              {dueAt && (
                <span className="text-[10px] text-text-tertiary">
                  Due{" "}
                  {new Date(dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
          )}

          {holdCount > 0 && (
            <span className="text-[11px] text-text-secondary font-medium">
              {holdCount} hold{holdCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * PublicBookCardSkeleton
 */
export function PublicBookCardSkeleton() {
  return (
    <div className="flex flex-col rounded-xl overflow-hidden bg-surface border border-border-subtle elev-1">
      <div className="w-full animate-pulse bg-surface-2" style={{ aspectRatio: "3/4" }} />
      <div className="flex flex-col gap-2 p-4">
        <div className="h-4 w-3/4 rounded bg-surface-2 animate-pulse" />
        <div className="h-3.5 w-1/2 rounded bg-surface-2 animate-pulse" />
        <div className="h-6 w-20 rounded-full bg-surface-2 mt-2 animate-pulse" />
      </div>
    </div>
  );
}
