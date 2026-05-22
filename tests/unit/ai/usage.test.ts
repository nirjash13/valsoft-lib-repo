/**
 * Unit tests for recordAiUsage (REQ-11-07).
 *
 * The full guarantee — a failed INSERT does not abort the outer Postgres
 * transaction — depends on SAVEPOINT semantics that only a real Postgres
 * connection can exercise; that belongs in an integration test against a Neon
 * branch (deferred follow-up). These unit tests cover the JS-observable
 * contract that REQ-11-07 actually hinges on: recordAiUsage never throws out to
 * its caller (so a usage-write failure cannot roll back the user-visible
 * action), and a write failure is logged at ALERT priority.
 */

import { recordAiUsage } from "@/lib/ai/usage";
import type { TenantId } from "@/lib/db/schema/_shared";
import { describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001" as TenantId;

const INPUT = {
  tenantId: TENANT,
  feature: "isbn_enrich",
  model: "anthropic/claude-haiku-4-5",
  promptTokens: 100,
  completionTokens: 50,
  costUsd: 0.0001,
};

/**
 * Builds a mock TxClient. `insertShouldThrow` simulates a failing DB insert.
 * `execute` (SAVEPOINT / RELEASE / ROLLBACK) is a no-op — the savepoint
 * protocol's effect is only meaningful against real Postgres.
 */
function makeMockTx(insertShouldThrow = false) {
  const insertValues = vi.fn(async () => {
    if (insertShouldThrow) throw new Error("simulated DB error");
  });
  const tx = {
    execute: vi.fn(async () => {}),
    insert: vi.fn(() => ({ values: insertValues })),
  };
  return { tx, insertValues };
}

describe("recordAiUsage", () => {
  it("writes the ai_usage row on the success path (REQ-11-07)", async () => {
    const { tx, insertValues } = makeMockTx(false);

    await recordAiUsage(tx as unknown as Parameters<typeof recordAiUsage>[0], INPUT);

    expect(insertValues).toHaveBeenCalledOnce();
  });

  it("does not throw and logs an ALERT when the insert fails (REQ-11-07)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { tx } = makeMockTx(true);

    // REQ-11-07: a usage-write failure must NOT propagate to the caller —
    // otherwise it would roll back the user-visible action.
    await expect(
      recordAiUsage(tx as unknown as Parameters<typeof recordAiUsage>[0], INPUT),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[ai-usage][ALERT]"),
      expect.anything(),
    );

    consoleSpy.mockRestore();
  });
});
