/**
 * Load-bearing: isFeatureEnabled must disable the feature when the env var is
 * explicitly "false", and enable it for all other values (absent, "true", etc.).
 *
 * This matters because the kill switch gates the entire expire-holds cron batch —
 * a wrong implementation would either silently skip all tenants in prod (if it
 * defaults to disabled) or ignore an operator disabling it (if it ignores "false").
 */

import { isFeatureEnabled } from "@/lib/flags";
import { afterEach, describe, expect, it } from "vitest";

describe("isFeatureEnabled", () => {
  afterEach(() => {
    // Use delete (not `= undefined`) — Node coerces undefined to "undefined" string,
    // which would leave the env var set and cause false-positive test results.
    // biome-ignore lint/performance/noDelete: env var must be fully removed, not set to "undefined"
    delete process.env.FEATURE_EXPIRE_HOLDS_ENABLED;
    // biome-ignore lint/performance/noDelete: env var must be fully removed, not set to "undefined"
    delete process.env.FEATURE_MY_FEATURE_ENABLED;
  });

  it('returns false when env var is explicitly "false"', async () => {
    process.env.FEATURE_EXPIRE_HOLDS_ENABLED = "false";
    expect(await isFeatureEnabled("expire_holds")).toBe(false);
  });

  it("returns true when env var is absent (default ON)", async () => {
    // Env var not set — feature is on by default.
    expect(await isFeatureEnabled("expire_holds")).toBe(true);
  });

  it('returns true when env var is "true"', async () => {
    process.env.FEATURE_MY_FEATURE_ENABLED = "true";
    expect(await isFeatureEnabled("my_feature")).toBe(true);
  });
});
