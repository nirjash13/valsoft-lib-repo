/**
 * selectIsbnBanner — pure function that determines which banner to show after
 * an ISBN preview lookup.
 *
 * Kept in lib/utils (not in a .tsx file) so Vitest can import it without a JSX
 * plugin.
 */

export type IsbnPreviewKind = "idle" | "loading" | "found" | "not_found" | "error";

export interface IsbnPreviewState {
  kind: IsbnPreviewKind;
}

/**
 * Returns the banner variant to render based on the current preview state.
 *
 * - "not_found" → warning banner: "We couldn't find this ISBN"
 * - "error"     → danger banner: server/network error message
 * - anything else → "none" (no banner)
 */
export function selectIsbnBanner(state: IsbnPreviewState): "none" | "not_found" | "error" {
  if (state.kind === "not_found") return "not_found";
  if (state.kind === "error") return "error";
  return "none";
}
