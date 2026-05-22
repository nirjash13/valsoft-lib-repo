/**
 * Regression test — REAL_SEND_STATUSES export from volume-cap.ts.
 *
 * Bug: volume-cap.ts had no exported constant; both assertEmailVolume and the
 * notifications page volume meter duplicated the status list, risking drift.
 * Fix: REAL_SEND_STATUSES is now exported and both consumers import it.
 *
 * This test fails when REAL_SEND_STATUSES is removed or its values change
 * without a corresponding update to assertEmailVolume — the shared definition
 * is the load-bearing invariant.
 */

import { REAL_SEND_STATUSES } from "@/lib/notifications/volume-cap";
import { describe, expect, it } from "vitest";

describe("REAL_SEND_STATUSES", () => {
  it("includes exactly the statuses that represent a real Resend dispatch", () => {
    const sorted = [...REAL_SEND_STATUSES].sort();
    expect(sorted).toStrictEqual(["bounced", "complained", "delivered", "queued", "sent"]);
  });
});
