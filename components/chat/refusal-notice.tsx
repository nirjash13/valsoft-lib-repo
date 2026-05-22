"use client";

import { cn } from "@/lib/utils/cn";
import { BookOpen } from "lucide-react";

interface RefusalNoticeProps {
  text: string;
  className?: string;
}

/**
 * RefusalNotice — distinct styling for an off-catalog refusal turn (REQ-06-03 / REQ-06-06).
 *
 * Friendly, not an error. The assistant explains it can only help with this library's catalog.
 */
export function RefusalNotice({ text, className }: RefusalNoticeProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3",
        className,
      )}
    >
      <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
      <p className="text-body text-text-secondary italic">{text}</p>
    </div>
  );
}
