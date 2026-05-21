"use client";

import { Button } from "@/components/ui/button";
import { useEffect } from "react";

interface BooksErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary for the books route segment.
 * Shown when the RSC throws an unexpected error.
 */
export default function BooksError({ error, reset }: BooksErrorProps) {
  useEffect(() => {
    // Log to error tracking (Sentry integration deferred to Spec 12)
    console.error("[BooksError]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-h3 text-[hsl(var(--text-primary))] mb-2">Something went wrong</p>
      <p className="text-body text-[hsl(var(--text-secondary))] mb-6 max-w-sm">
        The books list could not be loaded. This is likely a temporary issue.
      </p>
      <div className="flex items-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button
          variant="ghost"
          onClick={() => {
            window.location.href = "/books";
          }}
        >
          Reload page
        </Button>
      </div>
    </div>
  );
}
