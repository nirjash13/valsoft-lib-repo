/**
 * Regression test for H-1 / M-5 — ownership check in cancelHold.
 *
 * Load-bearing: without the callerMemberId ownership check, a member with
 * hold:delete (granted by the H-1 fix) could cancel any other member's hold
 * in the same tenant — a tenant-internal privilege escalation.
 *
 * This test verifies that cancelHold throws HoldOwnershipDeniedError when
 * callerMemberId is provided and does not match the hold's memberId.
 */

import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock schema modules to prevent DB connection at import time
// ---------------------------------------------------------------------------

vi.mock("@/lib/db/schema/holds", () => ({
  holds: Symbol("holds"),
}));

vi.mock("@/lib/audit/audit-log", () => ({
  writeAuditLog: vi.fn(),
}));

// Import module under test AFTER mocks
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { cancelHold } from "@/lib/domain/holds/cancel-hold";
import { HoldOwnershipDeniedError } from "@/lib/domain/holds/errors";

// ---------------------------------------------------------------------------
// Mock tx builder — models tx.select().from().where() → Promise<row[]>
// ---------------------------------------------------------------------------

function makeMockTx(selectResult: unknown[]) {
  const fromChain = { where: vi.fn(() => Promise.resolve(selectResult)) };
  const selectChain = { from: vi.fn(() => fromChain) };
  return { select: vi.fn(() => selectChain) };
}

const ctx: TenantCtx = {
  tenantId: "tenant-uuid-111",
  userId: "actor-uuid-222",
};

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("cancelHold — ownership check", () => {
  it("throws HoldOwnershipDeniedError when callerMemberId does not match the hold owner", async () => {
    // The hold belongs to member-A; the caller is member-B.
    const holdOwnerMemberId = "member-uuid-aaa";
    const callerMemberId = "member-uuid-bbb"; // different member

    const mockTx = makeMockTx([{ memberId: holdOwnerMemberId }]);

    await expect(
      cancelHold(mockTx as unknown as TxClient, ctx, {
        holdId: "hold-uuid-ccc",
        callerMemberId,
      }),
    ).rejects.toThrow(HoldOwnershipDeniedError);
  });
});
