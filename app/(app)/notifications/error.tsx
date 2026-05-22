/**
 * Notifications error boundary — shown by Next.js if the RSC page throws.
 *
 * Must be a Client Component per Next.js App Router requirements.
 */
"use client";

import { useEffect } from "react";

interface NotificationsErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function NotificationsError({ error, reset }: NotificationsErrorProps) {
  useEffect(() => {
    // Log to error monitoring in production (Sentry integration is app-level).
    console.error("[NotificationsPage] error boundary:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-text-primary font-semibold">Something went wrong</p>
      <p className="text-sm text-text-tertiary max-w-sm">
        The notifications page encountered an error. Try again, or contact support if the problem
        persists.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
      >
        Try again
      </button>
    </div>
  );
}
