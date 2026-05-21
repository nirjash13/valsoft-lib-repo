"use client";

import { cn } from "@/lib/utils/cn";
import { Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

interface BooksSearchProps {
  defaultValue?: string;
}

/**
 * Client-side search input for the books list.
 * Pushes `?q=...` to the URL on submit; RSC re-renders with the new filter.
 * Uses useTransition so the input stays responsive while the RSC reloads.
 */
export function BooksSearch({ defaultValue = "" }: BooksSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("q", value.trim());
      } else {
        params.delete("q");
      }
      params.delete("page"); // reset to page 1 on new search
      startTransition(() => {
        router.push(`/books?${params.toString()}`);
      });
    },
    [value, router, searchParams],
  );

  const handleClear = useCallback(() => {
    setValue("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("page");
    startTransition(() => {
      router.push(`/books?${params.toString()}`);
    });
  }, [router, searchParams]);

  return (
    <form onSubmit={handleSubmit} aria-label="Search books">
      <div className="relative max-w-sm">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--text-tertiary))]"
          aria-hidden
        />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search by title or ISBN…"
          aria-label="Search books by title or ISBN"
          className={cn(
            "w-full h-9 rounded-md pl-9 pr-9 py-2 text-body",
            "bg-[hsl(var(--bg-surface-2))] text-[hsl(var(--text-primary))]",
            "border border-[hsl(var(--border-default))]",
            "placeholder:text-[hsl(var(--text-tertiary))]",
            "focus-visible:outline-none focus-visible:border-[hsl(var(--border-strong))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--accent))]",
            "transition-instant transition-colors",
            isPending && "opacity-70",
          )}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2",
              "flex h-5 w-5 items-center justify-center rounded",
              "text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))]",
            )}
            aria-label="Clear search"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
}
