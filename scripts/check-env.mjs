#!/usr/bin/env node
// scripts/check-env.mjs
// Reports which expected env vars are SET or MISSING.
// Never prints values, only variable NAMES + length hints.
// Run: node --env-file=.env.local scripts/check-env.mjs

const expected = {
  Database: ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "DATABASE_URL_APP_DIRECT", "APP_BASE_URL"],
  "Auth0 (@auth0/nextjs-auth0 v4 expected)": [
    "AUTH0_SECRET",
    "AUTH0_BASE_URL",
    "AUTH0_ISSUER_BASE_URL",
    "AUTH0_DOMAIN",
    "AUTH0_CLIENT_ID",
    "AUTH0_CLIENT_SECRET",
    "AUTH0_AUDIENCE",
    "AUTH0_SCOPE",
  ],
};

for (const [group, vars] of Object.entries(expected)) {
  console.log(`\n[${group}]`);
  for (const name of vars) {
    const v = process.env[name];
    const status = v && v.length > 0 ? "SET" : "MISSING";
    if (status === "SET") {
      const lengthHint = v.length;
      const shape =
        name.includes("URL") || name.includes("ISSUER")
          ? v.startsWith("https://")
            ? "https://…"
            : v.startsWith("http://")
              ? "http://…"
              : "no-scheme"
          : "";
      console.log(
        `  ${name.padEnd(28)} SET     (len=${lengthHint}${shape ? `, shape=${shape}` : ""})`,
      );
    } else {
      console.log(`  ${name.padEnd(28)} MISSING`);
    }
  }
}

// Catch-all: list every other env var that mentions AUTH or AUTH0 by NAME ONLY.
console.log("\n[Other env vars containing AUTH (names only, no values)]");
const seen = new Set(Object.values(expected).flat());
const matches = Object.keys(process.env)
  .filter((k) => /AUTH|auth0/i.test(k))
  .filter((k) => !seen.has(k))
  .sort();
if (matches.length === 0) {
  console.log("  (none)");
} else {
  for (const k of matches) {
    const v = process.env[k];
    console.log(`  ${k.padEnd(28)} SET (len=${v?.length ?? 0})`);
  }
}
console.log("");
