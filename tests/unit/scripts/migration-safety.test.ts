/**
 * Load-bearing tests for migration-safety.mjs detectDestructiveOps().
 *
 * These tests verify that:
 * 1. A migration containing DROP COLUMN is flagged (blocks merge without label).
 * 2. A migration that only adds a nullable column is safe (passes without label).
 *
 * The BDD scenario: "destructive migration requires label" (REQ-12-08, §6).
 */

import { describe, expect, it } from "vitest";

// detectDestructiveOps is a pure function — no fs, no git, no side effects.
// We import from the .mjs script via a relative path. Vitest's Node environment
// resolves ESM .mjs imports correctly.
// @ts-ignore — .mjs scripts have no declaration files; allowJs is off in tsconfig.
import { detectDestructiveOps } from "../../../scripts/migration-safety.mjs";

describe("detectDestructiveOps", () => {
  it("flags DROP COLUMN as destructive", () => {
    const sql = `
      ALTER TABLE books DROP COLUMN isbn10;
    `;
    const ops = detectDestructiveOps(sql);
    expect(ops).toContain("DROP COLUMN");
  });

  it("flags DROP TABLE as destructive", () => {
    const sql = `
      DROP TABLE IF EXISTS legacy_holdings;
    `;
    const ops = detectDestructiveOps(sql);
    expect(ops).toContain("DROP TABLE");
  });

  it("flags SET NOT NULL on existing column as destructive", () => {
    const sql = `
      ALTER TABLE members ALTER COLUMN email SET NOT NULL;
    `;
    const ops = detectDestructiveOps(sql);
    expect(ops).toContain("SET NOT NULL");
  });

  it("passes (returns empty) for a nullable ADD COLUMN", () => {
    // Pure additive migration — no destructive ops
    const sql = `
      ALTER TABLE books ADD COLUMN subtitle varchar(500);
      CREATE INDEX books_tenant_subtitle_idx ON books (tenant_id, subtitle);
    `;
    const ops = detectDestructiveOps(sql);
    expect(ops).toHaveLength(0);
  });
});
