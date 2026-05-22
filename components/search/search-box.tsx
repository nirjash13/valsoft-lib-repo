"use client";

import { cn } from "@/lib/utils/cn";
import { Loader2, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

interface SearchBoxProps {
  defaultValue?: string;
  placeholder?: string;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

/**
 * Hybrid search box — debounces 250 ms, pushes ?q= into URL via router.replace.
 * 1-char query shows a "keep typing…" hint without firing a search.
 * useTransition gives a pending state while the RSC re-renders.
 */
export function SearchBox({
  defaultValue = "",
  placeholder = "Search by title, author, or describe what you want…",
}: SearchBoxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync if the URL changes externally (e.g. browser back)
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  const pushQuery = useCallback(
    (q: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (q.trim()) {
        params.set("q", q.trim());
      } else {
        params.delete("q");
      }
      // Clear facet/cursor state on new query
      params.delete("cursor");
      params.delete("subjects");
      params.delete("language");
      params.delete("availability");
      params.delete("yearFrom");
      params.delete("yearTo");
      startTransition(() => {
        router.replace(`/search?${params.toString()}`);
      });
    },
    [router, searchParams],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setValue(next);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      // 1-char guard: show hint but do not fire
      if (next.length === 1) return;

      debounceRef.current = setTimeout(() => {
        pushQuery(next);
      }, DEBOUNCE_MS);
    },
    [pushQuery],
  );

  const handleClear = useCallback(() => {
    setValue("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushQuery("");
  }, [pushQuery]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const showKeepTypingHint = value.length === 1;
  const showPendingSpinner = isPending && value.length >= MIN_QUERY_LENGTH;

  return (
    <div className="w-full">
      <div className="relative">
        {/* Leading icon — spinner when RSC transition pending, search icon otherwise */}
        {showPendingSpinner ? (
          <Loader2
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-accent animate-spin"
            aria-hidden
          />
        ) : (
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary"
            aria-hidden
          />
        )}

        <input
          type="search"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          aria-label="Search the catalog"
          aria-busy={isPending}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            "w-full h-10 rounded-lg pl-10 pr-9 py-2 text-body",
            "bg-surface-2 text-text-primary",
            "border border-border-default",
            "placeholder:text-text-tertiary",
            "focus-visible:outline-none focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-accent",
            "transition-instant transition-colors",
            isPending && "opacity-80",
          )}
        />

        {value && (
          <button
            type="button"
            onClick={handleClear}
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2",
              "flex h-6 w-6 items-center justify-center rounded",
              "text-text-tertiary hover:text-text-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            )}
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {showKeepTypingHint && (
        <output className="mt-1.5 text-meta text-text-tertiary" aria-live="polite">
          Keep typing to search…
        </output>
      )}
    </div>
  );
}
