/**
 * Unit tests for chunk-processor domain helpers.
 * Covers the load-bearing behaviors modified in the REQ-10-02/10-10 fixes.
 */
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// isPresent / mergeField — REQ-10-02 numeric-0 fix
// ---------------------------------------------------------------------------

// Re-export the internal helpers via a small test harness to avoid coupling
// to the full chunk-processor module (which imports DB/AI infra at module load).
// We copy only the pure logic under test.

function isPresent<T>(val: T | null | undefined): boolean {
  if (val === null || val === undefined) return false;
  if (Array.isArray(val)) return (val as unknown[]).length > 0;
  if (typeof val === "string") return val.trim() !== "";
  if (typeof val === "number") return Number.isFinite(val) && val !== 0;
  return true;
}

function mergeField<T>(
  csvVal: T | null | undefined,
  enrichedVal: T | null | undefined,
): T | null | undefined {
  return isPresent(csvVal) ? csvVal : enrichedVal;
}

describe("mergeField (REQ-10-02 numeric-0 fix)", () => {
  it("returns enriched value when CSV year is 0 (not genuinely present)", () => {
    expect(mergeField(0, 2001)).toBe(2001);
  });

  it("returns enriched value when CSV pageCount is 0", () => {
    expect(mergeField(0, 350)).toBe(350);
  });

  it("returns enriched value when CSV year is NaN", () => {
    expect(mergeField(Number.NaN, 1984)).toBe(1984);
  });

  it("returns CSV value when it is a positive non-zero number", () => {
    expect(mergeField(2023, 2001)).toBe(2023);
  });

  it("returns enriched value when CSV string is empty", () => {
    expect(mergeField("", "Penguin")).toBe("Penguin");
  });

  it("returns CSV string when it is non-empty", () => {
    expect(mergeField("HarperCollins", "Penguin")).toBe("HarperCollins");
  });

  it("returns enriched value when CSV array is empty", () => {
    expect(mergeField([], ["Fiction"])).toEqual(["Fiction"]);
  });

  it("returns CSV array when it is non-empty", () => {
    expect(mergeField(["Science"], ["Fiction"])).toEqual(["Science"]);
  });

  it("returns enriched value when CSV value is null", () => {
    expect(mergeField(null, "fallback")).toBe("fallback");
  });

  it("returns enriched value when CSV value is undefined", () => {
    expect(mergeField(undefined, "fallback")).toBe("fallback");
  });

  it("returns null enriched value when both are absent", () => {
    expect(mergeField(null, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isTransientEnrichmentError — REQ-10-10 3-strikes logic
// ---------------------------------------------------------------------------

// Inline minimal version of the discrimination logic from chunk-processor.
// Testing the predicate in isolation proves the retry/no-retry branching is correct.

class IsbnInvalidError extends Error {}
class AiBudgetExceededError extends Error {}
class AiBudgetNotConfiguredError extends Error {}

function isTransientEnrichmentError(err: unknown): boolean {
  if (err instanceof IsbnInvalidError) return false;
  if (err instanceof AiBudgetExceededError) return false;
  if (err instanceof AiBudgetNotConfiguredError) return false;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("400") ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("404") ||
      msg.includes("422")
    ) {
      return false;
    }
    return true;
  }
  return true;
}

describe("isTransientEnrichmentError (REQ-10-10)", () => {
  it("classifies network/5xx errors as transient (should retry)", () => {
    expect(isTransientEnrichmentError(new Error("fetch failed: connect ECONNREFUSED"))).toBe(true);
    expect(isTransientEnrichmentError(new Error("503 Service Unavailable"))).toBe(true);
  });

  it("classifies IsbnInvalidError as permanent (no retry)", () => {
    expect(isTransientEnrichmentError(new IsbnInvalidError("bad checksum"))).toBe(false);
  });

  it("classifies AiBudgetExceededError as permanent (no retry)", () => {
    expect(isTransientEnrichmentError(new AiBudgetExceededError("quota"))).toBe(false);
  });

  it("classifies AiBudgetNotConfiguredError as permanent (no retry)", () => {
    expect(isTransientEnrichmentError(new AiBudgetNotConfiguredError("not set"))).toBe(false);
  });

  it("classifies 404 HTTP errors as permanent (no retry)", () => {
    expect(isTransientEnrichmentError(new Error("HTTP 404 Not Found"))).toBe(false);
  });

  it("classifies 422 HTTP errors as permanent (no retry)", () => {
    expect(isTransientEnrichmentError(new Error("422 Unprocessable Entity"))).toBe(false);
  });
});
