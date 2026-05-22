/**
 * Mustache-style template interpolation.
 *
 * Replaces `{{key}}` tokens with values from `vars`.
 * Unknown tokens (keys not present in `vars`) are left intact — they are
 * NOT removed. This preserves template fidelity and lets callers detect
 * missing substitutions after the fact.
 *
 * Pure function — no side effects, no I/O.
 */

/**
 * Interpolates `{{key}}` tokens in `template` with values from `vars`.
 *
 * @example
 * interpolate("Hello, {{name}}!", { name: "Alice" })
 * // → "Hello, Alice!"
 *
 * interpolate("Due: {{due_date}} — {{unknown}}", { due_date: "2026-06-01" })
 * // → "Due: 2026-06-01 — {{unknown}}"
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim();
    return Object.prototype.hasOwnProperty.call(vars, trimmed) ? (vars[trimmed] ?? match) : match;
  });
}
