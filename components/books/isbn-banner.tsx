"use client";

import type { BookRecord } from "@/lib/domain/books/schemas";
import { selectIsbnBanner } from "@/lib/utils/isbn-banner";
import { AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * PreviewState — union of all states the ISBN lookup can be in.
 * Exported so new-book-form.tsx shares the same type definition.
 */
export type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; data: Partial<BookRecord>; sourceDiffs: Record<string, string> }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/**
 * IsbnBanner — renders the appropriate feedback banner for the current
 * ISBN preview state:
 *   - "not_found" → warning (yellow)
 *   - "error"     → danger (red)
 *   - "found"     → success (green)
 *   - anything else → nothing
 *
 * Opacity-alpha colour values (e.g. hsl(var(--warning)/0.08)) are kept as
 * inline styles because Tailwind v4 @theme tokens do not emit alpha-variant
 * utilities for hsl() variables. REVIEW: migrate when tokens move to oklch/rgb.
 */
export function IsbnBanner({ state }: { state: PreviewState }) {
  const banner = selectIsbnBanner(state);

  if (banner === "not_found") {
    return (
      <div
        className="mt-4 flex items-start gap-2 rounded-lg px-4 py-3 text-body border"
        style={{
          background: "hsl(var(--warning)/0.08)",
          borderColor: "hsl(var(--warning)/0.3)",
          color: "hsl(var(--warning))",
        }}
        aria-live="polite"
      >
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
        <span>We couldn&rsquo;t find this ISBN — please fill the fields and save.</span>
      </div>
    );
  }

  if (banner === "error") {
    return (
      <div
        className="mt-4 flex items-start gap-2 rounded-lg px-4 py-3 text-body border"
        style={{
          background: "hsl(var(--danger)/0.08)",
          borderColor: "hsl(var(--danger)/0.3)",
          color: "hsl(var(--danger))",
        }}
        role="alert"
      >
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
        <span>{state.kind === "error" ? state.message : "An error occurred."}</span>
      </div>
    );
  }

  if (state.kind === "found") {
    return (
      <div
        className="mt-4 flex items-start gap-2 rounded-lg px-4 py-3 text-body border"
        style={{
          background: "hsl(var(--success)/0.08)",
          borderColor: "hsl(var(--success)/0.3)",
          color: "hsl(var(--success))",
        }}
        aria-live="polite"
      >
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
        <span>Preview loaded — review and edit below, then save.</span>
      </div>
    );
  }

  return null;
}
