/**
 * scripts/check-prompt-changes.mjs — Prompt Change Gate (Spec 11 REQ-11-09)
 *
 * Usage (CI):
 *   node scripts/check-prompt-changes.mjs [base-ref]
 *
 *   base-ref defaults to "origin/main".
 *   If git fails (e.g. shallow clone, no remote), the script exits 0 with a notice.
 *
 * For each changed file under lib/ai/prompts/*.md this script:
 *   1. Requires the prompt's `version:` frontmatter to differ from the base-ref
 *      version. Fail: "prompt-change: bump version: in frontmatter of <file>"
 *   2. Requires at least one new/changed file under docs/decisions/ in the same diff.
 *      Fail: "prompt-change: add an ADR under docs/decisions/ for <file>"
 *
 * Exits non-zero if any check fails; exits 0 if no prompt files changed.
 *
 * Note: ADRs live under docs/decisions/ — another agent un-ignores that path
 * from .gitignore so CI can see them. This script trusts the diff output.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "..");

/**
 * Runs git and returns stdout as a string, or throws if git fails.
 */
function git(args) {
  return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: "utf8" });
}

/**
 * Extracts changed file paths from `git diff --name-only <baseRef>...HEAD`.
 * Returns an empty array if git fails.
 */
function getChangedFiles(baseRef) {
  try {
    const output = git(`diff --name-only ${baseRef}...HEAD`);
    return output.trim().split("\n").filter(Boolean);
  } catch {
    console.log(
      `[check-prompt-changes] NOTICE: git diff failed (baseRef=${baseRef}). Skipping prompt change checks (exit 0).`,
    );
    return null; // sentinel: git unavailable
  }
}

/**
 * Parses the YAML frontmatter `version:` field from a prompt markdown file.
 * Returns the version string, or null if absent/unparseable.
 */
function parseVersion(content) {
  // Match `version: 1.2` in the frontmatter block (between --- delimiters)
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const versionMatch = fmMatch[1].match(/^version:\s*(.+)$/m);
  return versionMatch ? versionMatch[1].trim() : null;
}

/**
 * Reads the version of a prompt file at a given git ref.
 * Returns null if the file didn't exist at that ref.
 */
function getVersionAtRef(filePath, ref) {
  try {
    const content = git(`show ${ref}:${filePath}`);
    return parseVersion(content);
  } catch {
    // File didn't exist at this ref — treat as new file (no base version to compare)
    return null;
  }
}

/**
 * Reads the version from the working tree (current file).
 */
function getCurrentVersion(absolutePath) {
  if (!existsSync(absolutePath)) return null;
  const content = readFileSync(absolutePath, "utf8");
  return parseVersion(content);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const baseRef = process.argv[2] ?? "origin/main";

  const changedFiles = getChangedFiles(baseRef);
  if (changedFiles === null) {
    // git unavailable — exit cleanly
    process.exit(0);
  }

  // Find changed prompt files
  const changedPrompts = changedFiles.filter((f) => f.match(/^lib\/ai\/prompts\/[^/]+\.md$/));

  if (changedPrompts.length === 0) {
    // No prompt files changed — nothing to check
    process.exit(0);
  }

  // Check for ADR presence in this diff
  const hasAdr = changedFiles.some((f) => f.startsWith("docs/decisions/"));

  let failed = false;

  for (const promptFile of changedPrompts) {
    const absolutePath = resolve(REPO_ROOT, promptFile);

    // Check 1: version bump
    const baseVersion = getVersionAtRef(promptFile, baseRef);
    const currentVersion = getCurrentVersion(absolutePath);

    if (baseVersion !== null && currentVersion === baseVersion) {
      // File existed before AND version hasn't changed
      console.error(
        `prompt-change: bump version: in frontmatter of ${promptFile}\n` +
          `  Current version: ${currentVersion}\n` +
          `  (must differ from ${baseRef} version: ${baseVersion})`,
      );
      failed = true;
    } else if (currentVersion === null) {
      console.error(`prompt-change: missing version: frontmatter in ${promptFile}`);
      failed = true;
    } else {
      const fromLabel = baseVersion !== null ? `${baseVersion} → ` : "(new file) → ";
      console.log(`[check-prompt-changes] OK: ${promptFile} version ${fromLabel}${currentVersion}`);
    }

    // Check 2: ADR entry
    if (!hasAdr) {
      console.error(
        `prompt-change: add an ADR under docs/decisions/ for ${promptFile}\n  No file matching docs/decisions/* was found in this diff.\n  Create docs/decisions/YYYY-MM-DD-<feature>-prompt-v<version>.md`,
      );
      failed = true;
    } else {
      const adrFiles = changedFiles.filter((f) => f.startsWith("docs/decisions/"));
      console.log(
        `[check-prompt-changes] OK: ADR present for ${promptFile}: ${adrFiles.join(", ")}`,
      );
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(`[check-prompt-changes] All ${changedPrompts.length} changed prompt file(s) passed.`);
}

main();
