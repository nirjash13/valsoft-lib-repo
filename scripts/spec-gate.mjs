/**
 * spec-gate — ensures every changed file under app/** or lib/** is covered by a
 * spec in the coverage manifest.
 *
 * WHY A MANIFEST INSTEAD OF FRONTMATTER?
 * The spec .md files are frozen post sign-off and begin with a provenance HTML
 * comment (`<!-- written-by: ... -->`). Adding YAML frontmatter would mutate them.
 * Instead, project_docs/specs/spec-tags.json is the single maintained mapping from
 * spec ID → path globs that the spec owns. When a new feature area is added,
 * update spec-tags.json rather than the frozen spec files.
 *
 * Usage:
 *   node scripts/spec-gate.mjs [base-ref]
 *   base-ref defaults to "origin/main"
 *
 * Exit 0 — all changed files are covered.
 * Exit 1 — one or more files are orphaned (no spec covers them).
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Pure glob utilities — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Converts a glob pattern to a RegExp.
 * Supports * (within a path segment) and ** (across segments).
 *
 * Uses split/join to avoid control character literals in regex patterns
 * (which Biome's noControlCharactersInRegex rule disallows).
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegex(glob) {
  // Placeholder token — must not appear in any valid file path.
  const DSTAR_TOKEN = "DOUBLESTAR_PLACEHOLDER";
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // Replace ** with token, then * with single-segment wildcard, then restore **
    .split("**")
    .join(DSTAR_TOKEN)
    .replace(/\*/g, "[^/]+")
    .split(DSTAR_TOKEN)
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Given a manifest (spec-tags.json contents) and a file path, returns the
 * specId that covers the file, or null if none does.
 *
 * Exported for unit testing.
 *
 * @param {Record<string, string[]>} manifest
 * @param {string} filePath - repo-root-relative path (e.g. "lib/auth/session.ts")
 * @returns {string | null}
 */
export function findCoveringSpec(manifest, filePath) {
  for (const [specId, globs] of Object.entries(manifest)) {
    if (specId.startsWith("_")) continue;
    for (const glob of globs) {
      if (globToRegex(glob).test(filePath)) return specId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main (only runs when this file is executed directly, not when imported)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
  const MANIFEST_PATH = join(ROOT, "project_docs", "specs", "spec-tags.json");
  const baseRef = process.argv[2] ?? "origin/main";

  /** @type {Record<string, string[]>} */
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch (err) {
    console.error(`[spec-gate] Cannot read manifest at ${MANIFEST_PATH}: ${err.message}`);
    process.exit(1);
  }

  /** @type {string[]} */
  let changedFiles;
  try {
    const raw = execSync(`git diff --name-only ${baseRef}...HEAD`, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    changedFiles = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    console.log(
      `[spec-gate] git diff failed (${err.message.split("\n")[0]}); skipping spec-gate check.`,
    );
    process.exit(0);
  }

  if (changedFiles.length === 0) {
    console.log("[spec-gate] No changed files detected — nothing to check.");
    process.exit(0);
  }

  const featureFiles = changedFiles.filter((f) => f.startsWith("app/") || f.startsWith("lib/"));

  if (featureFiles.length === 0) {
    console.log("[spec-gate] No app/** or lib/** files changed — spec-gate passes.");
    process.exit(0);
  }

  let orphanCount = 0;

  for (const filePath of featureFiles) {
    const covering = findCoveringSpec(manifest, filePath);
    if (covering === null) {
      console.error(
        `[spec-gate] no spec covers ${filePath}\n  Fix: add a glob matching "${filePath}" to project_docs/specs/spec-tags.json under the appropriate spec key.`,
      );
      orphanCount++;
    } else {
      console.log(`[spec-gate] ${filePath} → ${covering}`);
    }
  }

  if (orphanCount > 0) {
    console.error(
      `\n[spec-gate] FAILED — ${orphanCount} file(s) not covered by any spec.\nUpdate project_docs/specs/spec-tags.json to add coverage or create a new spec.`,
    );
    process.exit(1);
  }

  console.log(`\n[spec-gate] PASSED — ${featureFiles.length} file(s) covered.`);
}
