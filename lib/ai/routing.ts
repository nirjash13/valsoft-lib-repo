/**
 * Model routing table — Vercel AI Gateway provider/model slugs.
 *
 * This is the single config point for model selection (REQ-11-01, US-06):
 * swapping `primary` or `fallbacks` here re-routes traffic without touching
 * any call sites.
 *
 * Pricing constants are plausible 2026 gateway rates. Update these when the
 * gateway pricing page changes — they feed `estimateCostUsd` for budget checks.
 */

// ---------------------------------------------------------------------------
// Feature routing config
// ---------------------------------------------------------------------------

export interface FeatureRouting {
  /** Primary gateway model slug. */
  primary: string;
  /** Ordered fallback slugs (gateway tries these if primary is unavailable). */
  fallbacks: ReadonlyArray<string>;
  /** USD cost per 1 000 input tokens on the primary model. */
  costPer1kInputUsd: number;
  /** USD cost per 1 000 output tokens on the primary model. */
  costPer1kOutputUsd: number;
}

/**
 * Per-feature routing table. Keys match the `feature` tag in Langfuse spans
 * and the `feature` column in `ai_usage`.
 *
 * Spec §3: Sonnet 4.6 default, Haiku for cheap calls, GPT-5.5 / Cohere as fallbacks.
 */
export const FEATURE_ROUTING: Readonly<Record<string, FeatureRouting>> = {
  readers_advisor: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: ["openai/gpt-5.5", "cohere/command-r-plus"],
    costPer1kInputUsd: 0.003,
    costPer1kOutputUsd: 0.015,
  },
  isbn_enrich: {
    primary: "anthropic/claude-haiku-4-5",
    fallbacks: ["anthropic/claude-sonnet-4-6"],
    costPer1kInputUsd: 0.00025,
    costPer1kOutputUsd: 0.00125,
  },
  search_embed: {
    primary: "openai/text-embedding-3-small",
    fallbacks: ["cohere/embed-english-v3.0"],
    costPer1kInputUsd: 0.00002,
    costPer1kOutputUsd: 0,
  },
  reporting_nl: {
    primary: "anthropic/claude-haiku-4-5",
    fallbacks: ["openai/gpt-5.5"],
    costPer1kInputUsd: 0.00025,
    costPer1kOutputUsd: 0.00125,
  },
  patron_email_draft: {
    primary: "anthropic/claude-haiku-4-5",
    fallbacks: ["anthropic/claude-sonnet-4-6"],
    costPer1kInputUsd: 0.00025,
    costPer1kOutputUsd: 0.00125,
  },
} as const;

// These assertions are safe — the keys are defined in the same literal above.
// We use the fallback primary strings to avoid `noUncheckedIndexedAccess` errors.
const _readersAdvisorPrimary = "anthropic/claude-sonnet-4-6";
const _embeddingPrimary = "openai/text-embedding-3-small";

/**
 * Legacy convenience export — kept for backward compat with existing call sites
 * that import `MODELS` by name.
 */
export const MODELS = {
  readersAdvisor: _readersAdvisorPrimary,
  embedding: _embeddingPrimary,
} as const;

// ---------------------------------------------------------------------------
// routeModel
// ---------------------------------------------------------------------------

/**
 * Returns the primary gateway model slug for the given feature.
 * Falls back to `MODELS.readersAdvisor` (Sonnet 4.6) if the feature is unknown,
 * so new features get a safe default rather than a runtime error.
 */
export function routeModel(feature: string): string {
  return FEATURE_ROUTING[feature]?.primary ?? _readersAdvisorPrimary;
}

// ---------------------------------------------------------------------------
// estimateCostUsd
// ---------------------------------------------------------------------------

interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Estimates cost in USD for a given feature + token counts using the routing
 * table's per-1k-token pricing for the primary model.
 *
 * Returns 0 when the feature is unknown (safe default for budget pre-checks;
 * the feature will still be subject to the MTD cap check).
 */
export function estimateCostUsd(feature: string, tokens: TokenCounts): number {
  const routing = FEATURE_ROUTING[feature];
  if (!routing) return 0;
  return (
    (tokens.inputTokens / 1000) * routing.costPer1kInputUsd +
    (tokens.outputTokens / 1000) * routing.costPer1kOutputUsd
  );
}
