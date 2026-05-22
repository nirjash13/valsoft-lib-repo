/**
 * lint-prompts — validates YAML frontmatter on all prompt .md files under lib/ai/prompts/.
 *
 * Required fields: name, version, changed_in.
 * Body must be non-empty.
 *
 * Exit 0 if all prompts are valid; exit 1 if any fail.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const PROMPTS_DIR = join(ROOT, "lib", "ai", "prompts");

const REQUIRED_FIELDS = ["name", "version", "changed_in"];

let errors = 0;

const files = readdirSync(PROMPTS_DIR).filter((f) => f.endsWith(".md") && !f.startsWith("."));

if (files.length === 0) {
  console.log("lint:prompts — no prompt files found.");
  process.exit(0);
}

for (const file of files) {
  const filePath = join(PROMPTS_DIR, file);
  const raw = readFileSync(filePath, "utf8");

  if (!raw.startsWith("---")) {
    console.error(`[FAIL] ${file}: does not start with ---`);
    errors++;
    continue;
  }

  const secondFence = raw.indexOf("---", 3);
  if (secondFence === -1) {
    console.error(`[FAIL] ${file}: missing closing ---`);
    errors++;
    continue;
  }

  const frontmatter = raw.slice(3, secondFence).trim();
  const body = raw.slice(secondFence + 3).trim();

  /** @type {Map<string, string>} */
  const fields = new Map();
  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      console.error(`[FAIL] ${file}: invalid frontmatter line: "${trimmed}"`);
      errors++;
      continue;
    }
    fields.set(trimmed.slice(0, colonIdx).trim(), trimmed.slice(colonIdx + 1).trim());
  }

  let fileOk = true;
  for (const field of REQUIRED_FIELDS) {
    if (!fields.get(field)) {
      console.error(`[FAIL] ${file}: missing required field "${field}"`);
      errors++;
      fileOk = false;
    }
  }

  if (!body) {
    console.error(`[FAIL] ${file}: prompt body is empty`);
    errors++;
    fileOk = false;
  }

  if (fileOk) {
    console.log(`[OK]   ${file} (name=${fields.get("name")}, version=${fields.get("version")})`);
  }
}

if (errors > 0) {
  console.error(`\nlint:prompts — ${errors} error(s) found.`);
  process.exit(1);
} else {
  console.log(`\nlint:prompts — all ${files.length} prompt file(s) valid.`);
}
