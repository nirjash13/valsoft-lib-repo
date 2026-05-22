/**
 * Load-bearing tests for spec-gate.mjs findCoveringSpec() / globToRegex().
 *
 * These tests verify that:
 * 1. A file covered by a manifest glob is correctly identified.
 * 2. A file with no matching glob is returned as orphaned (null).
 * 3. The ** wildcard correctly matches across path segments.
 *
 * The BDD scenario: "spec-gate catches orphan code" (REQ-12-04, §6).
 */

import { describe, expect, it } from "vitest";

// @ts-ignore — .mjs scripts have no declaration files; allowJs is off in tsconfig.
import { findCoveringSpec, globToRegex } from "../../../scripts/spec-gate.mjs";

/** Minimal manifest fixture — mirrors the real spec-tags.json shape. */
const FIXTURE_MANIFEST = {
  _comment: "test fixture",
  "02-book-management": ["lib/domain/books/**", "app/(app)/books/**"],
  "06-readers-advisor": ["lib/ai/tools/**", "app/api/chat/**", "components/chat/**"],
  "12-sdlc-cicd-pipeline": ["scripts/spec-gate.mjs", ".github/**"],
};

describe("globToRegex", () => {
  it("matches a file directly under a ** glob", () => {
    const re = globToRegex("lib/domain/books/**");
    expect(re.test("lib/domain/books/create-book.ts")).toBe(true);
  });

  it("matches a nested file under a ** glob", () => {
    const re = globToRegex("lib/ai/tools/**");
    expect(re.test("lib/ai/tools/search/catalog-search.ts")).toBe(true);
  });

  it("does not match a sibling directory", () => {
    const re = globToRegex("lib/domain/books/**");
    expect(re.test("lib/domain/loans/borrow-book.ts")).toBe(false);
  });

  it("matches an exact path (no wildcards)", () => {
    const re = globToRegex("scripts/spec-gate.mjs");
    expect(re.test("scripts/spec-gate.mjs")).toBe(true);
    expect(re.test("scripts/migration-safety.mjs")).toBe(false);
  });
});

describe("findCoveringSpec", () => {
  it("returns the specId for a file matched by a glob in the manifest", () => {
    const result = findCoveringSpec(FIXTURE_MANIFEST, "lib/domain/books/list-books.ts");
    expect(result).toBe("02-book-management");
  });

  it("returns null for a file not matched by any glob (orphan)", () => {
    // lib/feature/foo.ts is not covered by any spec in the fixture manifest
    const result = findCoveringSpec(FIXTURE_MANIFEST, "lib/feature/foo.ts");
    expect(result).toBeNull();
  });

  it("returns the correct specId when multiple specs could theoretically match", () => {
    // scripts/spec-gate.mjs is only in 12-sdlc-cicd-pipeline
    const result = findCoveringSpec(FIXTURE_MANIFEST, "scripts/spec-gate.mjs");
    expect(result).toBe("12-sdlc-cicd-pipeline");
  });

  it("skips _comment key and does not treat it as a spec", () => {
    const result = findCoveringSpec(FIXTURE_MANIFEST, "_comment");
    expect(result).toBeNull();
  });
});
