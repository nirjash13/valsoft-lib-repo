/**
 * isFeatureEnabled — kill-switch helper.
 *
 * Placeholder for Edge Config integration (Spec 11 Rule 5). Reads from environment
 * variables until Edge Config is provisioned. The convention is:
 *
 *   FEATURE_<NAME_UPPERCASED>_ENABLED=false  →  disabled
 *   (absent or any other value)              →  enabled (default ON)
 *
 * Async to match the Edge Config interface that will replace this — callers must
 * always `await isFeatureEnabled(...)` so the swap requires no call-site changes.
 *
 * @param name - Feature flag name in snake_case (e.g. "expire_holds", "readers_advisor").
 */
export async function isFeatureEnabled(name: string): Promise<boolean> {
  const key = `FEATURE_${name.toUpperCase()}_ENABLED`;
  return process.env[key] !== "false";
}
