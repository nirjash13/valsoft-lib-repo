"use client";

import { cn } from "@/lib/utils/cn";
import { AlertCircle } from "lucide-react";

interface SearchErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Search error boundary — shown when the RSC search query throws.
 * "use client" is required by Next.js for error.tsx files.
 */
export default function SearchError({ reset }: SearchErrorProps) {
  return (
    <div className="max-w-[960px] mx-auto">
      <div className="mb-6">
        <h1 className="text-h1 text-text-primary">Search</h1>
      </div>

      <div
        className="flex flex-col items-center justify-center py-20 text-center"
        role="alert"
        aria-live="assertive"
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 bg-surface-2"
          aria-hidden
        >
          <AlertCircle className="h-8 w-8 text-danger" aria-hidden />
        </div>

        <p className="text-h3 text-text-primary mb-2">Something went wrong</p>

        <p className="text-body text-text-secondary mb-6 max-w-sm">
          The search couldn't complete. Please try again.
        </p>

        <button
          type="button"
          onClick={reset}
          className={cn(
            "inline-flex items-center rounded-lg px-5 py-2.5 text-body",
            "bg-accent text-accent-text",
            "hover:opacity-90",
            "transition-instant transition-opacity",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
