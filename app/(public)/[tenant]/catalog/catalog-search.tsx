"use client";

import { cn } from "@/lib/utils/cn";
import { Search, X } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

interface CatalogSearchProps {
  defaultValue?: string | undefined;
  /** Comma-separated subject filter value (from URL param). */
  defaultSubjects?: string | undefined;
  /** ISO 639-1 language filter value (from URL param). */
  defaultLanguage?: string | undefined;
}

/**
 * Client-side search input for the public catalog.
 * Pushes `?q=...&subjects=...&language=...` to the URL on submit.
 * Implements REQ-09-02/US-02 subject + language filter UI (MEDIUM).
 */
export function CatalogSearch({
  defaultValue = "",
  defaultSubjects,
  defaultLanguage,
}: CatalogSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant: tenantSlug } = useParams<{ tenant: string }>();
  const [value, setValue] = useState(defaultValue);
  const [subjects, setSubjects] = useState(defaultSubjects ?? "");
  const [language, setLanguage] = useState(defaultLanguage ?? "");
  const [isPending, startTransition] = useTransition();

  const buildParams = useCallback(
    (q: string, subj: string, lang: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (q.trim()) {
        params.set("q", q.trim());
      } else {
        params.delete("q");
      }
      if (subj.trim()) {
        params.set("subjects", subj.trim());
      } else {
        params.delete("subjects");
      }
      if (lang.trim()) {
        params.set("language", lang.trim());
      } else {
        params.delete("language");
      }
      params.delete("page"); // Reset to page 1 on new search
      return params;
    },
    [searchParams],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const params = buildParams(value, subjects, language);
      startTransition(() => {
        router.push(`/${tenantSlug}/catalog?${params.toString()}`);
      });
    },
    [value, subjects, language, router, tenantSlug, buildParams],
  );

  const handleClear = useCallback(() => {
    setValue("");
    setSubjects("");
    setLanguage("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("subjects");
    params.delete("language");
    params.delete("page");
    startTransition(() => {
      router.push(`/${tenantSlug}/catalog?${params.toString()}`);
    });
  }, [router, searchParams, tenantSlug]);

  const hasFilters = value || subjects || language;

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Search catalog"
      className="flex flex-col gap-2 w-full max-w-md"
    >
      {/* Search text input */}
      <div className="relative w-full">
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
        {hasFilters && (
          <button
            type="button"
            onClick={handleClear}
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2",
              "flex h-6 w-6 items-center justify-center rounded-md",
              "text-text-tertiary hover:text-text-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            )}
            aria-label="Clear search and filters"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {/* Subject filter — comma-separated, e.g. "Fiction,History" (REQ-09-02/US-02) */}
      <div className="flex gap-2">
        <input
          type="text"
          value={subjects}
          onChange={(e) => setSubjects(e.target.value)}
          placeholder="Subject filter (e.g. Fiction)"
          aria-label="Filter by subject"
          className={cn(
            "flex-1 h-9 rounded-lg px-3 text-body text-sm",
            "bg-surface-2 text-text-primary",
            "border border-border-default",
            "placeholder:text-text-tertiary",
            "focus-visible:outline-none focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-accent",
            "transition-instant transition-colors",
            isPending && "opacity-70",
          )}
        />

        {/* Language filter — ISO 639-1 code (REQ-09-02/US-02) */}
        <input
          type="text"
          value={language}
          onChange={(e) => setLanguage(e.target.value.toLowerCase().slice(0, 2))}
          placeholder="Lang (en)"
          aria-label="Filter by language code (e.g. en)"
          maxLength={2}
          className={cn(
            "w-24 h-9 rounded-lg px-3 text-body text-sm",
            "bg-surface-2 text-text-primary",
            "border border-border-default",
            "placeholder:text-text-tertiary",
            "focus-visible:outline-none focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-accent",
            "transition-instant transition-colors",
            isPending && "opacity-70",
          )}
        />

        <button
          type="submit"
          className={cn(
            "h-9 px-4 rounded-lg text-sm font-medium",
            "bg-accent text-white",
            "hover:bg-accent/90 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            isPending && "opacity-70",
          )}
          disabled={isPending}
          aria-label="Apply filters"
        >
          Search
        </button>
      </div>
    </form>
  );
}
