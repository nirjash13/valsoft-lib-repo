/**
 * isFeatureEnabled — kill-switch helper (Spec 11 REQ-11-04, Q-11-03).
 *
 * Resolution precedence (highest → lowest):
 *   1. DISABLED_AI_FEATURES env var — comma-separated list of tokens:
 *        - Bare token `feature`           → disables that feature platform-wide.
 *        - Scoped token `feature:tenantId` → disables for one tenant only.
 *      Example: DISABLED_AI_FEATURES=readers_advisor,isbn_enrich:550e8400-e29b-41d4-a716-446655440000
 *   2. FEATURE_<NAME>_ENABLED env var — legacy per-feature flag (back-compat).
 *        "false" → disabled; any other value or absent → enabled.
 *   3. Default: ON.
 *
 * The `DISABLED_AI_FEATURES` scheme uses string comparison, not env-var name
 * mangling, so tenant UUIDs (which contain hyphens) work correctly without
 * collision: `readers_advisor:abc-def` and `readers:advisor_abc-def` are
 * distinct tokens.
 *
 * Edge Config swap point: replace `readDisabledList()` and `readLegacyFlag()`
 * below with calls to `@vercel/edge-config`. The signature of `isFeatureEnabled`
 * and its callers do not change.
 *
 * Async to match the Edge Config interface — callers must always
 * `await isFeatureEnabled(...)` so the swap requires no call-site changes.
 *
 * @param name     - Feature flag name in snake_case (e.g. "readers_advisor").
 * @param tenantId - Optional tenant ID for per-tenant kill switches (Q-11-03).
 *                   When absent, only the platform-wide flag is checked.
 */
export async function isFeatureEnabled(name: string, tenantId?: string): Promise<boolean> {
  return resolveFlag(name, tenantId);
}

// ---------------------------------------------------------------------------
// Internal resolution — the single swap point for Edge Config.
// ---------------------------------------------------------------------------

function resolveFlag(name: string, tenantId?: string): boolean {
  // Layer 1: DISABLED_AI_FEATURES list (platform-wide OR per-tenant tokens).
  const disabledList = readDisabledList();
  if (disabledList.length > 0) {
    // Platform-wide disable: bare feature name.
    if (disabledList.includes(name)) return false;
    // Per-tenant disable: "feature:tenantId" scoped token.
    if (tenantId !== undefined && tenantId !== "") {
      if (disabledList.includes(`${name}:${tenantId}`)) return false;
    }
  }

  // Layer 2: legacy FEATURE_<NAME>_ENABLED env var (back-compat).
  const legacyVal = readLegacyFlag(name);
  if (legacyVal !== undefined) {
    return legacyVal !== "false";
  }

  // Layer 3: default ON.
  return true;
}

/**
 * Reads the DISABLED_AI_FEATURES env var and splits it into tokens.
 * Tokens are trimmed and empty strings are filtered out.
 * Swap this function body for `await get("disabled_ai_features")` when
 * migrating to Edge Config (and make `resolveFlag` async).
 */
function readDisabledList(): string[] {
  const raw = process.env.DISABLED_AI_FEATURES ?? "";
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Reads the legacy FEATURE_<NAME>_ENABLED env var.
 * Returns the raw string value, or undefined if the var is not set.
 * NAME is the feature name uppercased with non-alphanumeric chars replaced by _.
 */
function readLegacyFlag(name: string): string | undefined {
  const nameUpper = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return process.env[`FEATURE_${nameUpper}_ENABLED`];
}
