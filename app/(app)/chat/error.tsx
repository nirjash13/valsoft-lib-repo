"use client";

import { Button } from "@/components/ui/button";

interface ChatErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Chat error boundary — shown when the Server Component throws unexpectedly.
 * Must be a Client Component per Next.js error.tsx convention.
 */
export default function ChatError({ reset }: ChatErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center bg-danger/10 text-2xl"
        aria-hidden
      >
        ⚠️
      </div>
      <div>
        <h2 className="text-h3 text-text-primary font-semibold mb-1">
          The reading advisor is temporarily unavailable
        </h2>
        <p className="text-body text-text-secondary max-w-sm">
          Something went wrong loading the chat page. Please try again.
        </p>
      </div>
      <Button onClick={reset} variant="secondary">
        Try again
      </Button>
    </div>
  );
}
