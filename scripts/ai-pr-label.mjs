/**
 * ai-pr-label — heuristic AI-authorship detector for pull requests.
 *
 * HONESTY NOTE: This is a heuristic, not a ground-truth provenance tracker.
 * True per-line AI authorship is not tracked in this repo. The heuristic
 * uses two signals:
 *
 *   1. Co-authored-by trailer — if any commit in the diff contains a
 *      "Co-Authored-By: Claude" trailer (as written by Claude Code), the PR
 *      is treated as AI-authored. This is the primary signal.
 *
 *   2. Diff size gate — if the total number of added lines exceeds 200 AND
 *      signal 1 is true, the label is applied. A tiny AI-assisted commit
 *      (e.g. typo fix) does not need extra scrutiny.
 *
 * Output (one machine-readable line for the CI workflow to parse):
 *   ai-pr-label: apply    — apply the `ai-generated-pr` label
 *   ai-pr-label: skip     — do not apply the label
 *
 * The CI job reads this output via `>> $GITHUB_OUTPUT` and calls
 * `gh pr edit --add-label ai-generated-pr` and posts the review comment.
 *
 * Usage:
 *   node scripts/ai-pr-label.mjs [base-ref]
 *   base-ref defaults to "origin/main"
 *
 * Exit 0 always (this is informational, not a gate).
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const baseRef = process.argv[2] ?? "origin/main";

// ---------------------------------------------------------------------------
// Signal 1: Co-Authored-By: Claude trailer in commit messages
// ---------------------------------------------------------------------------
let hasClaudeTrailer = false;
let addedLines = 0;

try {
  const log = execSync(`git log ${baseRef}...HEAD --format=%B`, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The Claude Code trailer format: Co-Authored-By: Claude ... <noreply@anthropic.com>
  hasClaudeTrailer = /Co-Authored-By:\s*Claude/i.test(log);
} catch (err) {
  console.log(
    `[ai-pr-label] git log failed (${err.message.split("\n")[0]}); assuming no Claude trailer.`,
  );
}

// ---------------------------------------------------------------------------
// Signal 2: Count added lines in the diff
// ---------------------------------------------------------------------------
try {
  const diffStat = execSync(`git diff --numstat ${baseRef}...HEAD`, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const line of diffStat.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const added = Number.parseInt(parts[0] ?? "0", 10);
    if (!Number.isNaN(added)) addedLines += added;
  }
} catch (_err) {
  // Non-fatal — diff size stays 0
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------
const AI_LINE_THRESHOLD = 200;

const shouldApply = hasClaudeTrailer && addedLines >= AI_LINE_THRESHOLD;

console.log(`[ai-pr-label] claude-trailer: ${hasClaudeTrailer}`);
console.log(`[ai-pr-label] added-lines:    ${addedLines}`);
console.log(`[ai-pr-label] threshold:       ${AI_LINE_THRESHOLD}`);
console.log(`[ai-pr-label] decision:        ${shouldApply ? "apply" : "skip"}`);
console.log("");

if (shouldApply) {
  console.log("ai-pr-label: apply");
  console.log(
    "[ai-pr-label] This PR is largely AI-authored. Please apply extra scrutiny to: architecture compliance, edge cases, silent regressions.",
  );
} else {
  console.log("ai-pr-label: skip");
}

process.exit(0);
