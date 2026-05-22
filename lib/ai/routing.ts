/**
 * Model routing table — Vercel AI Gateway provider/model slugs.
 * Swap these strings to reroute traffic without touching call sites.
 * Full per-feature routing and fallbacks are Spec 11.
 */
export const MODELS = {
  readersAdvisor: "anthropic/claude-sonnet-4-6",
  embedding: "openai/text-embedding-3-small",
} as const;
