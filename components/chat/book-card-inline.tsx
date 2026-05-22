"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { coverGradient } from "@/lib/utils/cover-color";
import { BookMarked, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

/**
 * Compact book data sourced from search_catalog / get_book_detail tool results.
 * Matches the shape emitted by those tools (Builder B).
 */
export interface BookCardData {
  book_id: string;
  title: string;
  authors: string[];
  year?: number | null;
  coverUrl?: string | null;
  /** true = currently on loan; false / absent = available */
  on_loan?: boolean;
  holds_queue_length?: number;
}

interface BookCardInlineProps {
  data: BookCardData;
  className?: string;
}

/**
 * BookCardInline — compact book card for the chat rail (REQ-06-05).
 *
 * Renders title, author, cover, availability badge, and a link to the book detail page.
 * Kept intentionally compact so it fits in a chat message without dominating the thread.
 */
export function BookCardInline({ data, className }: BookCardInlineProps) {
  const gradient = coverGradient(data.title);
  const primaryAuthor = data.authors[0] ?? "Unknown Author";
  const authorDisplay =
    data.authors.length > 1 ? `${primaryAuthor} +${data.authors.length - 1}` : primaryAuthor;

  const isAvailable = !data.on_loan;
  const availabilityLabel = isAvailable
    ? "Available"
    : data.holds_queue_length !== undefined && data.holds_queue_length > 0
      ? `On loan · ${data.holds_queue_length} hold${data.holds_queue_length > 1 ? "s" : ""}`
      : "On loan";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border-subtle bg-surface p-3",
        "elev-1",
        className,
      )}
    >
      {/* Compact cover — 2:3 ratio, 48px wide */}
      <div
        className="relative shrink-0 rounded overflow-hidden"
        style={{ width: 48, height: 72 }}
        aria-hidden
      >
        {data.coverUrl ? (
          <Image
            src={data.coverUrl}
            alt={`Cover of ${data.title}`}
            fill
            sizes="48px"
            className="object-cover"
          />
        ) : (
          <div
            className="absolute inset-0 flex flex-col justify-end p-1"
            style={{ background: gradient }}
          >
            <p className="text-[9px] text-white/90 font-semibold line-clamp-3 leading-tight">
              {data.title}
            </p>
          </div>
        )}
      </div>

      {/* Metadata + actions */}
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <Link
          href={`/books/${data.book_id}`}
          className={cn(
            "text-meta font-semibold text-text-primary line-clamp-2 leading-snug",
            "hover:text-accent transition-instant transition-colors",
            "focus-visible:outline-none focus-visible:underline",
          )}
        >
          {data.title}
        </Link>
        <p className="text-[12px] text-text-secondary line-clamp-1">{authorDisplay}</p>

        {/* Availability badge */}
        <span
          className={cn(
            "mt-0.5 inline-flex w-fit items-center rounded-full px-2 py-0.5",
            "text-[11px] font-medium",
            isAvailable ? "bg-success/10 text-success" : "bg-surface-2 text-text-tertiary",
          )}
          aria-label={`Availability: ${availabilityLabel}`}
        >
          {availabilityLabel}
        </span>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 mt-1">
          <Button size="sm" asChild>
            <Link href={`/books/${data.book_id}`}>
              <ExternalLink className="h-3 w-3" aria-hidden />
              View
            </Link>
          </Button>
          {!isAvailable && (
            <Button size="sm" variant="secondary" asChild>
              <Link href={`/books/${data.book_id}`}>
                <BookMarked className="h-3 w-3" aria-hidden />
                Hold
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
