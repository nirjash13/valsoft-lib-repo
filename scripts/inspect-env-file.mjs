#!/usr/bin/env node
// scripts/inspect-env-file.mjs
// Reads .env.local structurally and reports per-line: variable name, whether
// it's commented out, and value length. NEVER prints values.
//
// Run: node scripts/inspect-env-file.mjs

import { readFile } from "node:fs/promises";

const path = ".env.local";
let raw;
try {
  raw = await readFile(path, "utf8");
} catch (err) {
  console.error(`Could not read ${path}: ${err.message}`);
  process.exit(1);
}

const lines = raw.split(/\r?\n/);
console.log(`Inspecting ${path} (${lines.length} lines)\n`);

let lineNum = 0;
const found = { uncommented: [], commented: [] };

for (const line of lines) {
  lineNum++;
  const trimmed = line.trim();
  if (trimmed === "") continue;

  // Pure comment line (no = sign that looks like a var)
  const commentMatch = trimmed.match(/^#\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (commentMatch) {
    const [, name, valuePart] = commentMatch;
    const hasValue = valuePart.trim().length > 0;
    found.commented.push({ lineNum, name, hasValue });
    console.log(
      `  L${String(lineNum).padStart(3)}: # ${name.padEnd(28)} commented out${hasValue ? ` (has value, len=${valuePart.trim().length})` : ""}`,
    );
    continue;
  }

  // Plain comment without var
  if (trimmed.startsWith("#")) continue;

  // Uncommented var
  const varMatch = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (varMatch) {
    const [, name, valuePart] = varMatch;
    const valLen = valuePart.length;
    found.uncommented.push({ lineNum, name, valLen });
    console.log(
      `  L${String(lineNum).padStart(3)}:   ${name.padEnd(28)} ACTIVE${valLen > 0 ? ` (len=${valLen})` : " (empty value)"}`,
    );
  }
}

console.log("");
console.log("Summary:");
console.log(`  Active vars     : ${found.uncommented.length}`);
console.log(`  Commented-out   : ${found.commented.length}`);

// Specifically flag Auth0-named lines.
const authActive = found.uncommented.filter((v) => /^AUTH/.test(v.name));
const authCommented = found.commented.filter((v) => /^AUTH/.test(v.name));
console.log(
  `  Auth0 active    : ${authActive.length} -> [${authActive.map((v) => v.name).join(", ") || "(none)"}]`,
);
console.log(
  `  Auth0 commented : ${authCommented.length} -> [${authCommented.map((v) => `${v.name}${v.hasValue ? "(has value)" : ""}`).join(", ") || "(none)"}]`,
);
