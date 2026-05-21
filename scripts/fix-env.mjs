#!/usr/bin/env node
// scripts/fix-env.mjs
//
// Patches .env.local to finalize Auth0 setup:
//   1. Uncomments any AUTH0_* lines that already have a value behind `# `.
//   2. Fills in AUTH0_SECRET with a fresh 32-byte hex if not already set.
//   3. Sets AUTH0_BASE_URL to APP_BASE_URL (defaulting to http://localhost:3000).
//   4. Derives AUTH0_ISSUER_BASE_URL from AUTH0_DOMAIN (`https://<domain>`).
//   5. Adds AUTH0_AUDIENCE + AUTH0_SCOPE with sensible defaults if missing.
//
// The script:
//   - Backs up the file to .env.local.bak before any change.
//   - Reads + writes locally; values never enter stdout (only a report of
//     variable NAMES + their resulting status).
//   - Is idempotent — running it again on the same file is a no-op.
//
// Run: node scripts/fix-env.mjs

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";

const path = ".env.local";
if (!existsSync(path)) {
  console.error(`${path} not found. Create it from .env.local.example first.`);
  process.exit(1);
}

const raw = await readFile(path, "utf8");
await copyFile(path, `${path}.bak`);
console.log(`Backed up ${path} → ${path}.bak`);

// --- Parse ---
const lines = raw.split(/\r?\n/);

// Build a map of var name -> { lineIndex, commented, value }
const vars = new Map();
const lineRecords = [];
lines.forEach((line, i) => {
  const commented = line.match(/^#\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
  const active = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (commented) {
    const [, name, value] = commented;
    vars.set(name, { lineIndex: i, commented: true, value });
    lineRecords.push({ kind: "commented-var", name, i });
    return;
  }
  if (active && !line.trim().startsWith("#")) {
    const [, name, value] = active;
    vars.set(name, { lineIndex: i, commented: false, value });
    lineRecords.push({ kind: "active-var", name, i });
    return;
  }
  lineRecords.push({ kind: "other", i });
});

function getActiveValue(name) {
  const v = vars.get(name);
  if (!v || v.commented) return null;
  return v.value;
}

function setLine(i, content) {
  lines[i] = content;
}

// --- Activate AUTH0_* lines that already have values ---
const toActivate = ["AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_DOMAIN", "AUTH0_ORG"];

const activated = [];
for (const name of toActivate) {
  const rec = vars.get(name);
  if (rec?.commented && rec.value.length > 0) {
    setLine(rec.lineIndex, `${name}=${rec.value}`);
    rec.commented = false;
    activated.push(name);
  }
}

// --- Fill in the three derivable values ---
function setOrInsert(name, value, insertAfterLine) {
  const rec = vars.get(name);
  if (rec) {
    // Existing line — overwrite (whether previously commented or not)
    setLine(rec.lineIndex, `${name}=${value}`);
    rec.commented = false;
    rec.value = value;
    return "updated";
  }
  // No existing line — insert
  lines.splice(insertAfterLine + 1, 0, `${name}=${value}`);
  vars.set(name, { lineIndex: insertAfterLine + 1, commented: false, value });
  return "inserted";
}

// AUTH0_SECRET — generate if missing/empty
const existingSecret = getActiveValue("AUTH0_SECRET");
if (!existingSecret || existingSecret.length < 32) {
  const secret = randomBytes(32).toString("hex"); // 64 hex chars = 256 bits
  setOrInsert("AUTH0_SECRET", secret, lines.length - 1);
}

// AUTH0_BASE_URL — match APP_BASE_URL or fall back to localhost
const appBaseUrl = getActiveValue("APP_BASE_URL") ?? "http://localhost:3000";
setOrInsert("AUTH0_BASE_URL", appBaseUrl, lines.length - 1);

// AUTH0_ISSUER_BASE_URL — derived from AUTH0_DOMAIN
const domain = getActiveValue("AUTH0_DOMAIN");
if (!domain) {
  console.error(
    "ERROR: AUTH0_DOMAIN is not set (not even commented with a value). " +
      "Add it to .env.local (e.g. `AUTH0_DOMAIN=dev-xxxxx.us.auth0.com`) and re-run.",
  );
  process.exit(1);
}
const issuer = `https://${domain}`;
setOrInsert("AUTH0_ISSUER_BASE_URL", issuer, lines.length - 1);

// AUTH0_AUDIENCE — optional; default to the Management API audience format if missing
const audience = getActiveValue("AUTH0_AUDIENCE");
if (!audience) {
  setOrInsert("AUTH0_AUDIENCE", `https://${domain}/api/v2/`, lines.length - 1);
}

// AUTH0_SCOPE — default for Run B
const scope = getActiveValue("AUTH0_SCOPE");
if (!scope) {
  setOrInsert("AUTH0_SCOPE", "openid profile email offline_access", lines.length - 1);
}

// --- Write back ---
await writeFile(path, lines.join("\n"), "utf8");

// --- Report (names only, no values) ---
console.log("\nActivated (uncommented):");
if (activated.length === 0) {
  console.log("  (none — were any of these already active?)");
} else {
  for (const n of activated) console.log(`  ${n}`);
}

console.log("\nFinal status (names + lengths, no values):");
const finalLines = (await readFile(path, "utf8")).split(/\r?\n/);
const finalVars = new Map();
for (const line of finalLines) {
  const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m && !line.trim().startsWith("#")) {
    finalVars.set(m[1], m[2]);
  }
}
const want = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "DATABASE_URL_APP_DIRECT",
  "APP_BASE_URL",
  "AUTH0_SECRET",
  "AUTH0_BASE_URL",
  "AUTH0_ISSUER_BASE_URL",
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_AUDIENCE",
  "AUTH0_SCOPE",
  "AUTH0_ORG",
];
for (const name of want) {
  const v = finalVars.get(name);
  if (v && v.length > 0) {
    console.log(`  ${name.padEnd(28)} SET    (len=${v.length})`);
  } else {
    console.log(`  ${name.padEnd(28)} MISSING`);
  }
}
console.log("");
console.log("Done. Run `pnpm exec node --env-file=.env.local scripts/check-env.mjs` to verify.");
