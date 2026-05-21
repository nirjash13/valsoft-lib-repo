import { selectIsbnBanner } from "@/lib/utils/isbn-banner";
import { describe, expect, it } from "vitest";

/**
 * Load-bearing: selectIsbnBanner drives which user-visible banner appears after
 * an ISBN lookup (BDD scenarios REQ-02-01). If this breaks, the librarian sees
 * the wrong feedback — the demo golden path breaks visibly.
 *
 * Three equivalence classes map to the three BDD scenarios:
 *   found   → "none"      (success, no warning banner needed)
 *   not_found → "not_found" (BDD: "We couldn't find this ISBN")
 *   error   → "error"     (network/server failure)
 */
describe("selectIsbnBanner", () => {
  it("returns 'none' when preview found a book", () => {
    expect(selectIsbnBanner({ kind: "found" })).toBe("none");
  });

  it("returns 'not_found' when both sources returned empty", () => {
    expect(selectIsbnBanner({ kind: "not_found" })).toBe("not_found");
  });

  it("returns 'error' on a server/network error", () => {
    expect(selectIsbnBanner({ kind: "error" })).toBe("error");
  });

  it("returns 'none' when still idle (no lookup yet)", () => {
    expect(selectIsbnBanner({ kind: "idle" })).toBe("none");
  });
});
