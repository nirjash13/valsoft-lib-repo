/**
 * cover-color.ts — derives a deterministic gradient for the typographic cover fallback.
 *
 * Pure function: given a title string, returns a CSS linear-gradient value.
 * Used when cover_url is empty — produces an intentional typographic cover
 * (brief §Open design questions #3: "typographic — it looks intentional and never breaks the grid").
 *
 * The gradient is derived from the djb2 hash of the title so the same book
 * always gets the same color (stable across renders).
 */

/** Palette of hue values that read well on dark text (used in the cover overlay). */
const HUES = [212, 248, 175, 30, 330, 160, 280, 15] as const;

/**
 * djb2 hash — fast, simple, good distribution for short strings.
 * Returns an unsigned 32-bit integer.
 */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + (s.charCodeAt(i) | 0)) >>> 0;
  }
  return h;
}

/**
 * Returns a CSS `linear-gradient(...)` string for use as a fallback book cover.
 *
 * @param title - The book title. Empty string produces the first gradient.
 */
export function coverGradient(title: string): string {
  const hash = djb2(title || "untitled");
  const hue1 = HUES[hash % HUES.length] ?? 212;
  const hue2 = HUES[(hash >> 4) % HUES.length] ?? 248;
  return `linear-gradient(135deg, hsl(${hue1} 40% 18%) 0%, hsl(${hue2} 50% 12%) 100%)`;
}
