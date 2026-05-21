import { canRenew, computeDueAt } from "@/lib/domain/loans/loan-policy";
import { describe, expect, it } from "vitest";

describe("computeDueAt", () => {
  it("adds loan_duration_days calendar days to the checkout date", () => {
    const checkedOut = new Date("2026-06-01T10:00:00.000Z");
    const due = computeDueAt(checkedOut, 14);
    expect(due.toISOString()).toBe("2026-06-15T10:00:00.000Z");
  });

  it("handles month boundary correctly (leap year February → March)", () => {
    // 2028 is a leap year; Feb 20 + 14 days = Mar 5
    const checkedOut = new Date("2028-02-20T00:00:00.000Z");
    const due = computeDueAt(checkedOut, 14);
    expect(due.toISOString()).toBe("2028-03-05T00:00:00.000Z");
  });
});

describe("canRenew", () => {
  it("returns true when count is below max and no hold is queued", () => {
    expect(canRenew({ renewedCount: 0, maxRenewals: 2, hasQueuedHold: false })).toBe(true);
  });

  it("returns false when renewal limit is reached", () => {
    expect(canRenew({ renewedCount: 2, maxRenewals: 2, hasQueuedHold: false })).toBe(false);
  });

  it("returns false when a queued hold exists even if count is below max", () => {
    expect(canRenew({ renewedCount: 0, maxRenewals: 2, hasQueuedHold: true })).toBe(false);
  });
});
