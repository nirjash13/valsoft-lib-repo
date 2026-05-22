"use client";

import { cn } from "@/lib/utils/cn";
import { Search, X } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

interface CatalogSearchProps {
  defaultValue?: string;
}

/**
 * Client-side search input for the public catalog.
 * Pushes `?q=...` to the URL on submit.
 */
export function CatalogSearch({ defaultValue = "" }: CatalogSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant: tenantSlug } = useParams<{ tenant: string }>();
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
      params.delete("page"); // Reset to page 1 on new search
      startTransition(() => {
        router.push(`/${tenantSlug}/catalog?${params.toString()}`);
      });
    },
    [value, router, searchParams, tenantSlug],
  );

  const handleClear = useCallback(() => {
    setValue("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("page");
    startTransition(() => {
      router.push(`/${tenantSlug}/catalog?${params.toString()}`);
    });
  }, [router, searchParams, tenantSlug]);

  return (
    <form onSubmit={handleSubmit} aria-label="Search catalog">
      <div className="relative w-full max-w-md">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary"
          aria-hidden
        />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search by title, author, or subject..."
          aria-label="Search books in public catalog"
          className={cn(
            "w-full h-10 rounded-lg pl-10 pr-10 py-2.5 text-body",
            "bg-surface-2 text-text-primary",
            "border border-border-default",
            "placeholder:text-text-tertiary",
            "focus-visible:outline-none focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-accent",
            "transition-instant transition-colors",
            isPending && "opacity-70",
          )}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2",
              "flex h-6 w-6 items-center justify-center rounded-md",
              "text-text-tertiary hover:text-text-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            )}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
}
