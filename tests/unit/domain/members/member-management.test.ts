/**
 * Unit tests for Spec 04 member management domain helpers.
 *
 * Load-bearing tests only — each covers a behavior that, if broken, would cause
 * visible user-facing pain (per testing.md Load-Bearing Filter).
 *
 * NOT tested here (deferred to integration tests):
 *   - Database interactions (selfSignup, approveMember, rejectMember)
 *   - Optimistic concurrency checks (require real tx)
 *   - Last-tenant-admin count query (requires real tx)
 */

import { canBorrow } from "@/lib/domain/members/can-borrow";
import {
  LastTenantAdminError,
  MemberAlreadyApprovedError,
  MemberAlreadyRejectedError,
  MemberNotPendingError,
} from "@/lib/domain/members/errors";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// canBorrow — pure helper
// ---------------------------------------------------------------------------

describe("canBorrow", () => {
  it("returns true for active members", () => {
    // Load-bearing: if this returns false, active members cannot borrow (broken circulation).
    expect(canBorrow({ status: "active" })).toBe(true);
  });

  it("returns false for pending members", () => {
    // Load-bearing: pending members must not be able to borrow (REQ-04-08).
    expect(canBorrow({ status: "pending" })).toBe(false);
  });

  it("returns false for rejected members", () => {
    expect(canBorrow({ status: "rejected" })).toBe(false);
  });

  it("returns false for suspended members", () => {
    expect(canBorrow({ status: "suspended" })).toBe(false);
  });

  it("returns false for inactive members", () => {
    // Load-bearing: REQ-04-07 deactivated accounts must not borrow.
    expect(canBorrow({ status: "inactive" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error shape — stable codes used by clients and safe-action mapper
// ---------------------------------------------------------------------------

describe("MemberNotPendingError", () => {
  it("carries the current status and a stable code", () => {
    // Load-bearing: the safe-action error mapper and client UX depend on the code string.
    const err = new MemberNotPendingError("member-123", "active");
    expect(err.code).toBe("MEMBER_NOT_PENDING");
    expect(err.message).toContain("active");
    expect(err.memberId).toBe("member-123");
  });
});

describe("MemberAlreadyApprovedError", () => {
  it("carries a stable code", () => {
    const err = new MemberAlreadyApprovedError("member-456");
    expect(err.code).toBe("MEMBER_ALREADY_APPROVED");
  });
});

describe("MemberAlreadyRejectedError", () => {
  it("carries a stable code", () => {
    const err = new MemberAlreadyRejectedError("member-789");
    expect(err.code).toBe("MEMBER_ALREADY_REJECTED");
  });
});

describe("LastTenantAdminError", () => {
  it("carries a stable code and tenant context", () => {
    // Load-bearing: if the code changes, client-side 409 handling for last-admin
    // reverts to the generic conflict message instead of the specific warning.
    const err = new LastTenantAdminError("tenant-xyz");
    expect(err.code).toBe("LAST_TENANT_ADMIN");
    expect(err.tenantId).toBe("tenant-xyz");
  });
});
