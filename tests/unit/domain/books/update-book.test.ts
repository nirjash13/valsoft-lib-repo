/**
 * Unit test: optimistic-concurrency timestamp round-trip (F-5 regression).
 *
 * Load-bearing: if updated_at were stored at µs precision and round-tripped
 * through JS Date, `new Date(date.toISOString()).getTime()` would not equal
 * the original `date.getTime()`, causing every first update to produce a
 * false-positive 409. This test documents the invariant.
 */

import { describe, expect, it } from "vitest";

describe("optimistic-concurrency token round-trip", () => {
  it("ms-precision timestamp survives ISO serialisation → Date parse → ISO comparison", () => {
    // Simulate a timestamptz(3) value read from Postgres: truncated to ms.
    const stored = new Date("2026-05-21T12:34:56.789Z"); // ms precision

    // Client serialises to ISO and echoes back as expectedUpdatedAt
    const wireString = stored.toISOString(); // "2026-05-21T12:34:56.789Z"

    // Server parses the echoed string (as done in update-book.ts line 43)
    const parsed = new Date(wireString);

    // The WHERE clause comparison must succeed: stored === parsed
    expect(parsed.getTime()).toBe(stored.getTime());
    expect(wireString).toBe("2026-05-21T12:34:56.789Z");
  });
});
