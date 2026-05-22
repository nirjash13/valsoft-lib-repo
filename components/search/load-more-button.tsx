"use client";

import { cn } from "@/lib/utils/cn";
import Link from "next/link";

interface LoadMoreButtonProps {
  cursor: string;
  /** Base search URL (path + existing params, WITHOUT cursor). */
  searchHref: string;
}

/**
 * "Load more" as a Link — appends cursor param to the current URL.
 * Implemented as a plain link so it works without JS and preserves all other
 * active search params. The RSC re-renders with the appended page.
 */
export function LoadMoreButton({ cursor, searchHref }: LoadMoreButtonProps) {
  // Build the full URL with cursor appended
  const url = new URL(searchHref, "http://placeholder");
  url.searchParams.set("cursor", cursor);
  const href = `/search?${url.searchParams.toString()}`;

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-5 py-2.5",
        "bg-surface-2 border border-border-default text-body text-text-primary",
        "hover:bg-elevated hover:border-border-strong",
        "transition-instant transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      )}
    >
      Load more
    </Link>
  );
}
