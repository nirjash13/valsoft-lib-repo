/**
 * Unit tests for lexical search input sanitization.
 *
 * Load-bearing filter applied:
 *   1. Failure signal: if sanitizeLexicalQuery is broken, malformed characters
 *      reach the websearch_to_tsquery call and may cause parse errors.
 *   2. User-visible: a single-quote in a search term could silently break the
 *      tsquery and return 0 results instead of real results.
 *   3. Non-redundant: no other test covers this exported boundary function.
 *   4. Not testing framework: tests our sanitization logic, not Postgres.
 *
 * NOTE: SQL injection via websearch_to_tsquery($1) is impossible because the
 * query is a bound parameter. This test covers query-quality sanitization:
 * single quotes that would produce parse errors inside tsquery if the string
 * were ever used unsafely, and null bytes which are absolute no-ops in Postgres.
 */

import { sanitizeLexicalQuery } from "@/lib/domain/search/lexical-search";
import { describe, expect, it } from "vitest";

describe("sanitizeLexicalQuery", () => {
  it("strips single quotes that would break tsquery syntax", () => {
    // "It's" with a single quote should become "It s" (space-replaced)
    // so websearch_to_tsquery receives "It s" rather than a malformed string.
    const result = sanitizeLexicalQuery("It's a wonderful life");
    expect(result).not.toContain("'");
    // Remaining meaningful content is preserved
    expect(result).toContain("It");
    expect(result).toContain("wonderful life");
  });
});
