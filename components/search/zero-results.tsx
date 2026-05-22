"use client";

import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";

// FOLLOW-UP-05B: REQ-05-08 nearest-3 suggestions — Run A's hybridSearch logs the
// zero-result event but does NOT return nearest 3 semantic suggestions in the
// SearchResponse shape. When Run A adds a `suggestions: SearchResult[]` field to
// SearchResponse (IT-05-8), replace the generic empty state below with the
// "Did you mean these?" list rendering.

interface ZeroResultsProps {
  query: string;
}

/**
 * Zero-results empty state.
 * Shows a friendly message, and a "Suggest we add this" CTA.
 */
export function ZeroResults({ query }: ZeroResultsProps) {
  function handleSuggest() {
    // No-op with toast — backend suggestion endpoint deferred (no new endpoint in Run B).
    toast.success("Thanks — we've noted it!", {
      description: `We'll look into adding "${query}" to the catalog.`,
      duration: 4000,
    });
  }

  return (
    <output
      className="flex flex-col items-center justify-center py-20 text-center"
      aria-live="polite"
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 text-3xl bg-surface-2"
        aria-hidden
      >
        🔍
      </div>

      <p className="text-h3 text-text-primary mb-2">
        No results for <span className="text-accent">"{query}"</span>
      </p>

      <p className="text-body text-text-secondary mb-6 max-w-sm">
        Try different keywords, check your spelling, or describe what you're looking for in plain
        language.
      </p>

      <button
        type="button"
        onClick={handleSuggest}
        className={cn(
          "inline-flex items-center rounded-lg px-4 py-2 text-body",
          "bg-surface-2 border border-border-default text-text-secondary",
          "hover:bg-elevated hover:text-text-primary hover:border-border-strong",
          "transition-instant transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        Suggest we add this
      </button>
    </output>
  );
}
