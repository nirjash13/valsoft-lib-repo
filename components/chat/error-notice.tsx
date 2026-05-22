"use client";

import { cn } from "@/lib/utils/cn";
import { WifiOff } from "lucide-react";

interface ErrorNoticeProps {
  className?: string;
}

/**
 * ErrorNotice — shown on 503 or stream errors.
 *
 * REQ-11-08 friendly copy: "the reading advisor is temporarily unavailable".
 */
export function ErrorNotice({ className }: ErrorNoticeProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3",
        className,
      )}
    >
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      <div>
        <p className="text-meta font-semibold text-text-primary">
          The reading advisor is temporarily unavailable
        </p>
        <p className="text-meta text-text-secondary mt-0.5">
          Please try again in a few moments. If the problem persists, contact your library
          administrator.
        </p>
      </div>
    </div>
  );
}
