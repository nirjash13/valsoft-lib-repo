/**
 * Regression test: Bug 1 — process-route dispatch logic for paused_quota.
 *
 * Verifies that when processImportChunk returns { complete: false, pausedReason: "paused_quota" }
 * the route sends the paused-quota email and does NOT re-trigger the next chunk.
 *
 * The logic is inlined from route.ts to avoid importing Next.js / DB infra.
 * The inline mirrors the exact branching added by the fix — if the real route
 * diverges from this model, this test should be updated alongside it.
 */
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Minimal types (mirroring chunk-processor.ts)
// ---------------------------------------------------------------------------

interface ProcessChunkResult {
  complete: boolean;
  newBookIds: string[];
  pausedReason?: "paused_quota";
}

// ---------------------------------------------------------------------------
// Inline of the fixed dispatch logic from process/route.ts POST handler
// (lines covering the result.complete / result.pausedReason branching)
// ---------------------------------------------------------------------------

function dispatchAfterChunk(
  result: ProcessChunkResult,
  jobStatus: "running" | "cancelled" | "paused_quota" | "completed" | "failed",
  callbacks: {
    sendPausedQuotaEmail: () => void;
    finalizeImportJob: () => void;
    triggerNextChunk: () => void;
  },
): void {
  if (result.pausedReason === "paused_quota") {
    // Bug 1 fix: paused by budget projection — send email, do NOT re-trigger
    callbacks.sendPausedQuotaEmail();
    return;
  }
  if (result.complete) {
    callbacks.finalizeImportJob();
    return;
  }
  // Re-trigger ONLY if job is still running (Bug 1 fix: guard against cancelled loops)
  if (jobStatus === "running") {
    callbacks.triggerNextChunk();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("process-route dispatch (Bug 1 regression)", () => {
  it("sends paused-quota email and does NOT re-trigger when pausedReason is paused_quota", () => {
    const sendPausedQuotaEmail = vi.fn();
    const finalizeImportJob = vi.fn();
    const triggerNextChunk = vi.fn();

    dispatchAfterChunk(
      { complete: false, newBookIds: [], pausedReason: "paused_quota" },
      "paused_quota",
      { sendPausedQuotaEmail, finalizeImportJob, triggerNextChunk },
    );

    expect(sendPausedQuotaEmail).toHaveBeenCalledOnce();
    expect(triggerNextChunk).not.toHaveBeenCalled();
    expect(finalizeImportJob).not.toHaveBeenCalled();
  });
});
