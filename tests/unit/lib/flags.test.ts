/**
 * Load-bearing: isFeatureEnabled must disable the feature when the flag is set,
 * and enable it for all other values (absent, "true", etc.).
 * Additionally, per-tenant overrides must take precedence over platform-wide flags
 * and platform-wide flags must take precedence over the default-ON fallback.
 *
 * This matters because:
 * - The kill switch gates the entire expire-holds cron batch — a wrong
 *   implementation would either silently skip all tenants in prod (defaults
 *   to disabled) or ignore an operator disabling it (ignores "false").
 * - The per-tenant override (REQ-11-04, Q-11-03) allows disabling an AI
 *   feature for a single misbehaving tenant without touching the platform flag.
 * - Token collision: `readers_advisor` + tenant `abc-def` must NOT collide with
 *   `readers` + tenant `advisor_abc-def`. The colon separator used in
 *   DISABLED_AI_FEATURES makes these distinct tokens.
 */

import { isFeatureEnabled } from "@/lib/flags";
import { afterEach, describe, expect, it } from "vitest";

// Real UUID tenant ID — exercises the UUID path that was previously broken by
// the env-var-name-mangling approach (finding #5).
const UUID_TENANT = "550e8400-e29b-41d4-a716-446655440000";

describe("isFeatureEnabled", () => {
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: env vars must be fully removed
    delete process.env.FEATURE_EXPIRE_HOLDS_ENABLED;
    // biome-ignore lint/performance/noDelete: env vars must be fully removed
    delete process.env.FEATURE_MY_FEATURE_ENABLED;
    // biome-ignore lint/performance/noDelete: env vars must be fully removed
    delete process.env.FEATURE_READERS_ADVISOR_ENABLED;
    // biome-ignore lint/performance/noDelete: env vars must be fully removed
    delete process.env.DISABLED_AI_FEATURES;
  });

  it('returns false when legacy env var is explicitly "false"', async () => {
    process.env.FEATURE_EXPIRE_HOLDS_ENABLED = "false";
    expect(await isFeatureEnabled("expire_holds")).toBe(false);
  });

  it("returns true when env var is absent (default ON)", async () => {
    expect(await isFeatureEnabled("expire_holds")).toBe(true);
  });

  it('returns true when legacy env var is "true"', async () => {
    process.env.FEATURE_MY_FEATURE_ENABLED = "true";
    expect(await isFeatureEnabled("my_feature")).toBe(true);
  });

  it("DISABLED_AI_FEATURES platform-wide token disables feature for all tenants", async () => {
    process.env.DISABLED_AI_FEATURES = "readers_advisor";
    expect(await isFeatureEnabled("readers_advisor")).toBe(false);
    expect(await isFeatureEnabled("readers_advisor", UUID_TENANT)).toBe(false);
  });

  it("DISABLED_AI_FEATURES per-tenant token disables feature for one UUID tenant only", async () => {
    process.env.DISABLED_AI_FEATURES = `readers_advisor:${UUID_TENANT}`;
    // The targeted tenant is disabled.
    expect(await isFeatureEnabled("readers_advisor", UUID_TENANT)).toBe(false);
    // Other tenants are NOT disabled.
    expect(await isFeatureEnabled("readers_advisor", "other-tenant-id")).toBe(true);
    // Platform-wide check (no tenantId) is also unaffected.
    expect(await isFeatureEnabled("readers_advisor")).toBe(true);
  });

  it("no collision: readers_advisor+tenant-abc vs readers+advisor_tenant-abc", async () => {
    // readers + tenant "advisor_tenant-abc" is disabled
    process.env.DISABLED_AI_FEATURES = "readers:advisor_tenant-abc";
    // readers_advisor + any tenant must NOT be affected
    expect(await isFeatureEnabled("readers_advisor", "advisor_tenant-abc")).toBe(true);
    // readers + correct tenant IS affected
    expect(await isFeatureEnabled("readers", "advisor_tenant-abc")).toBe(false);
  });

  it("platform-wide legacy flag applies when no DISABLED_AI_FEATURES and no per-tenant entry", async () => {
    process.env.FEATURE_READERS_ADVISOR_ENABLED = "false";
    expect(await isFeatureEnabled("readers_advisor", UUID_TENANT)).toBe(false);
  });

  it("DISABLED_AI_FEATURES takes precedence over legacy FEATURE_*_ENABLED=true", async () => {
    process.env.FEATURE_READERS_ADVISOR_ENABLED = "true";
    process.env.DISABLED_AI_FEATURES = "readers_advisor";
    expect(await isFeatureEnabled("readers_advisor")).toBe(false);
  });
});
