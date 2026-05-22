"use client";

import { cn } from "@/lib/utils/cn";
import { AlertCircle } from "lucide-react";

interface QuotaBannerProps {
  className?: string;
}

/**
 * QuotaBanner — shown when /api/chat/stream returns 402 (AI quota exceeded).
 *
 * REQ-06-07: friendly "AI quota reached" copy; chat input is disabled while this is shown.
 */
export function QuotaBanner({ className }: QuotaBannerProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div>
        <p className="text-meta font-semibold text-text-primary">AI quota reached this month</p>
        <p className="text-meta text-text-secondary mt-0.5">
          Your library's AI usage limit has been reached. Please try again next month or contact
          your library administrator to increase the limit.
        </p>
      </div>
    </div>
  );
}
