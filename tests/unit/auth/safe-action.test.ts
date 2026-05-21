import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

// Mock requireSession so the auth middleware passes with a fake session
vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    sub: "auth0|test-user",
    orgId: "org_test_abc",
    email: "test@example.com",
    roles: ["member"],
  }),
  // sessionToTenantCtx is now async; return a resolved UUID-shaped tenantId
  sessionToTenantCtx: vi.fn().mockResolvedValue({
    tenantId: "00000000-0000-0000-0000-000000000001",
    userId: "auth0|test-user",
  }),
}));

// Mock @/lib/auth0 so the module doesn't try to read AUTH0_DOMAIN at import time
vi.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: vi.fn().mockResolvedValue(null),
  },
}));

// Import actionClient AFTER mocks are in place
import { actionClient } from "@/lib/auth/safe-action";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("actionClient permission middleware", () => {
  /**
   * CRITICAL regression test: an action defined without .metadata() must return
   * a 403 PermissionDenied server error, NOT a 500 TypeError.
   *
   * Before the fix: `metadata.permission` threw "Cannot read properties of undefined
   * (reading 'permission')" → mapped by handleServerError to generic 500.
   * A 500 with no detail leaks nothing to the client, but it:
   *   (a) obscures the actual failure (programmer omitted .metadata())
   *   (b) looks like an infrastructure error rather than an authz error
   *   (c) in some monitoring setups is silently rate-limited or suppressed
   *
   * After the fix: explicit check `if (!metadata || ...)` throws PermissionDeniedError
   * → mapped to 403 with a clear "no permission metadata declared" message.
   *
   * This is a SECURITY regression: without the explicit check, a future contributor
   * who defines actionClient.schema(X).action(...) (no .metadata()) would silently
   * fail-closed by accident (TypeError), not by design. The test ensures it fails
   * closed by DESIGN — a 403 the middleware intentionally throws.
   */
  it("action without .metadata() returns 403 PermissionDenied, not 500 TypeError", async () => {
    // Define an action WITHOUT .metadata() — the pathological case
    const actionWithoutMetadata = actionClient
      .schema(z.object({ input: z.string() }))
      // Deliberately NO .metadata({ permission: "..." }) call
      .action(async () => {
        return { ok: true };
      });

    const result = await actionWithoutMetadata({ input: "test" });

    // next-safe-action returns serverError for error paths
    expect(result?.serverError).toBeDefined();

    // Must be 403, not 500
    const parsed = JSON.parse(result?.serverError as string) as {
      status: number;
      title: string;
    };
    expect(parsed.status).toBe(403);
    expect(parsed.title).toBe("Permission Denied");
  });
});
