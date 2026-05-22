/**
 * BrandVoiceForm — "use client" form to update tenant brand voice.
 *
 * US-06: tenant admin selects warm / formal / academic.
 */

"use client";

import { updateBrandVoiceAction } from "@/app/(app)/settings/actions";
import type { BrandVoice } from "@/lib/domain/settings/schemas";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";

const BRAND_VOICE_OPTIONS: { value: BrandVoice; label: string; description: string }[] = [
  {
    value: "warm",
    label: "Warm",
    description: "Friendly and encouraging — addresses patrons as neighbours who love reading.",
  },
  {
    value: "formal",
    label: "Formal",
    description: "Professional and concise — no contractions; clear and direct.",
  },
  {
    value: "academic",
    label: "Academic",
    description: "Respectful and scholarly — appropriate for an academic community.",
  },
];

interface BrandVoiceFormProps {
  currentBrandVoice: BrandVoice;
}

export function BrandVoiceForm({ currentBrandVoice }: BrandVoiceFormProps) {
  const [selected, setSelected] = useState<BrandVoice>(currentBrandVoice);
  const [savedVoice, setSavedVoice] = useState<BrandVoice>(currentBrandVoice);

  const { execute, isPending, result } = useAction(updateBrandVoiceAction, {
    onSuccess: ({ data }) => {
      if (data) setSavedVoice(data.brandVoice as BrandVoice);
    },
  });

  const isDirty = selected !== savedVoice;

  function parseServerError(serverError: string | undefined): string | null {
    if (!serverError) return null;
    try {
      const parsed = JSON.parse(serverError) as { detail?: string; title?: string };
      return parsed.detail ?? parsed.title ?? serverError;
    } catch {
      return serverError;
    }
  }

  const serverError = parseServerError(result.serverError);

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium text-text-primary">Brand voice</legend>
        <p className="mt-1 text-sm text-text-tertiary">
          The AI draft mode will use this tone when composing patron emails.
        </p>
        <div className="mt-3 space-y-2">
          {BRAND_VOICE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border-subtle bg-surface p-3 transition-colors hover:bg-elevated has-[:checked]:border-accent has-[:checked]:bg-[hsl(var(--accent)/0.06)]"
            >
              <input
                type="radio"
                name="brand-voice"
                value={opt.value}
                checked={selected === opt.value}
                onChange={() => setSelected(opt.value)}
                className="mt-0.5 accent-[hsl(var(--accent))]"
                aria-describedby={`bv-desc-${opt.value}`}
              />
              <div className="flex-1">
                <span className="block text-sm font-medium text-text-primary">{opt.label}</span>
                <span
                  id={`bv-desc-${opt.value}`}
                  className="block text-xs text-text-tertiary mt-0.5"
                >
                  {opt.description}
                </span>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => execute({ brandVoice: selected })}
          disabled={!isDirty || isPending}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          aria-busy={isPending}
        >
          {isPending ? (
            <>
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"
                aria-hidden="true"
              />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </button>

        {!isDirty && savedVoice === selected && result.data && (
          <output className="text-sm text-green-700 dark:text-green-400 font-medium">Saved</output>
        )}

        {serverError !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {serverError}
          </p>
        )}
      </div>
    </div>
  );
}
