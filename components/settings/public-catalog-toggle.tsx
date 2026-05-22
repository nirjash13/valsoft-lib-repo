"use client";

/**
 * PublicCatalogToggle — "use client" toggle to enable/disable the public catalog.
 *
 * US-05 / REQ-09-05: tenant admin controls whether the public catalog is visible.
 * Mirrors the shape of BrandVoiceForm: useAction hook, isPending state, server error display.
 */

import { updatePublicCatalogAction } from "@/app/(app)/settings/actions";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";

interface PublicCatalogToggleProps {
  currentEnabled: boolean;
  tenantSlug: string;
}

export function PublicCatalogToggle({ currentEnabled, tenantSlug }: PublicCatalogToggleProps) {
  const [enabled, setEnabled] = useState(currentEnabled);

  const { execute, isPending, result } = useAction(updatePublicCatalogAction, {
    onSuccess: ({ data }) => {
      if (data) setEnabled(data.enabled);
    },
  });

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
  const publicUrl = `/${tenantSlug}/catalog`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-text-primary">
            {enabled ? "Enabled" : "Disabled"}
          </p>
          <p className="text-xs text-text-tertiary mt-0.5">
            {enabled
              ? `Your catalog is publicly visible at ${publicUrl}.`
              : "Your catalog is hidden from the public. Enable it to let visitors browse your collection."}
          </p>
        </div>

        {/* Toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? "Disable public catalog" : "Enable public catalog"}
          aria-busy={isPending}
          disabled={isPending}
          onClick={() => execute({ enabled: !enabled })}
          className={[
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            enabled ? "bg-accent" : "bg-border-default",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-6" : "translate-x-1",
            ].join(" ")}
          />
        </button>
      </div>

      {serverError !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {serverError}
        </p>
      )}

      {!isPending && result.data && (
        <output className="text-sm text-green-700 dark:text-green-400 font-medium">Saved</output>
      )}
    </div>
  );
}
