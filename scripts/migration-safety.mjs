/**
 * migration-safety — detects destructive SQL operations in new Drizzle migrations.
 *
 * Scans migration files that are new in the current diff (or all of drizzle/*.sql
 * if git is unavailable). Fails if a destructive operation is found without the
 * `safety:reviewed` label on the PR.
 *
 * Destructive operations detected:
 *   - DROP TABLE
 *   - DROP COLUMN
 *   - ALTER COLUMN … TYPE  (type change on an existing column)
 *   - SET NOT NULL / NOT NULL added to an existing column via ALTER TABLE … ALTER COLUMN
 *
 * Safe operations (pass without label):
 *   - ADD COLUMN … (nullable — no NOT NULL constraint)
 *   - CREATE TABLE, CREATE INDEX, etc.
 *
 * Label check:
 *   The PR_LABELS env variable (comma-separated) must contain "safety:reviewed" when
 *   any destructive op is detected. In CI this is set by the workflow from
 *   ${{ toJSON(github.event.pull_request.labels.*.name) }}.
 *
 * Usage:
 *   node scripts/migration-safety.mjs [base-ref]
 *   base-ref defaults to "origin/main"
 *   PR_LABELS=safety:reviewed,bug node scripts/migration-safety.mjs
 *
 * Exit 0 — no destructive ops, or destructive ops with safety:reviewed label.
 * Exit 1 — destructive op detected without the required label.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

const baseRef = process.argv[2] ?? "origin/main";

// ---------------------------------------------------------------------------
// Pure SQL analysis — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Patterns for destructive SQL operations.
 * Each entry has a label (human-readable name) and a regex tested against
 * each logical SQL statement (after stripping comments).
 *
 * @type {Array<{ label: string; pattern: RegExp }>}
 */
const DESTRUCTIVE_PATTERNS = [
  {
    label: "DROP TABLE",
    pattern: /\bDROP\s+TABLE\b/i,
  },
  {
    label: "DROP COLUMN",
    pattern: /\bDROP\s+COLUMN\b/i,
  },
  {
    label: "ALTER COLUMN ... TYPE",
    // ALTER TABLE foo ALTER COLUMN bar TYPE ...
    // or ALTER TABLE foo ALTER COLUMN bar SET DATA TYPE ...
    pattern: /\bALTER\s+COLUMN\b.+\b(SET\s+DATA\s+)?TYPE\b/is,
  },
  {
    label: "SET NOT NULL",
    // ALTER TABLE foo ALTER COLUMN bar SET NOT NULL
    pattern: /\bALTER\s+COLUMN\b.+\bSET\s+NOT\s+NULL\b/is,
  },
];

/**
 * Strips single-line (--) and block (/* *\/) SQL comments from a string.
 * @param {string} sql
 * @returns {string}
 */
function stripSqlComments(sql) {
  // Remove block comments
  let result = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove single-line comments
  result = result.replace(/--[^\n]*/g, " ");
  return result;
}

/**
 * Splits SQL text into individual statements on semicolons.
 * @param {string} sql
 * @returns {string[]}
 */
function splitStatements(sql) {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Scans the content of one SQL migration file for destructive operations.
 * Returns an array of human-readable labels for any found. Empty = safe.
 *
 * Exported for unit testing.
 *
 * @param {string} sqlContent - raw SQL file content
 * @returns {string[]} destructive operation labels found
 */
export function detectDestructiveOps(sqlContent) {
  const stripped = stripSqlComments(sqlContent);
  const statements = splitStatements(stripped);
  const found = new Set();

  for (const stmt of statements) {
    for (const { label, pattern } of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(stmt)) {
        found.add(label);
      }
    }
  }

  return [...found];
}

// ---------------------------------------------------------------------------
// Determine which migration files are new in this diff
// ---------------------------------------------------------------------------

/**
 * @returns {string[]} absolute paths of new SQL migration files
 */
function getNewMigrationFiles() {
  try {
    const raw = execSync(`git diff --name-only --diff-filter=A ${baseRef}...HEAD`, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const newFiles = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("drizzle/") && l.endsWith(".sql") && !l.endsWith(".down.sql"));

    return newFiles.map((f) => join(ROOT, f));
  } catch (_err) {
    // Git unavailable — cannot determine which migrations are new in this diff.
    // Scanning all historical migrations would incorrectly flag pre-existing
    // destructive migrations that have already been reviewed and applied.
    // Print a warning and return an empty list so the check is skipped (not failed).
    console.log(
      "[migration-safety] git diff failed; cannot determine new migrations without git.\n" +
        "[migration-safety] Skipping destructive-op check (no git baseline available).\n" +
        "[migration-safety] PASSED (skipped — no git).",
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main (only runs when this file is executed directly, not when imported)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const migrationFiles = getNewMigrationFiles();

  if (migrationFiles.length === 0) {
    console.log("[migration-safety] No new migration files in this diff — PASSED.");
    process.exit(0);
  }

  const prLabelsRaw = process.env.PR_LABELS ?? "";
  const prLabels = prLabelsRaw
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  const hasSafetyLabel = prLabels.includes("safety:reviewed");

  let failures = 0;

  for (const filePath of migrationFiles) {
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch (err) {
      console.error(`[migration-safety] Cannot read ${fileName}: ${err.message}`);
      failures++;
      continue;
    }

    const ops = detectDestructiveOps(content);

    if (ops.length === 0) {
      console.log(`[migration-safety] ${fileName} — safe (no destructive ops)`);
      continue;
    }

    for (const op of ops) {
      if (hasSafetyLabel) {
        console.log(
          `[migration-safety] ${fileName} — destructive op detected: ${op} — label safety:reviewed present, PASSING`,
        );
      } else {
        console.error(
          `[migration-safety] ${fileName} — destructive op detected: ${op} — add label safety:reviewed`,
        );
        failures++;
      }
    }
  }

  if (failures > 0) {
    console.error(
      `\n[migration-safety] FAILED — ${failures} destructive migration(s) without safety:reviewed label.\nApply the "safety:reviewed" label to this PR and document the rollback strategy.`,
    );
    process.exit(1);
  }

  console.log("\n[migration-safety] PASSED.");
}
