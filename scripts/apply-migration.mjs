#!/usr/bin/env node
// scripts/apply-migration.mjs
//
// One-shot migration applier. Reads drizzle/<arg>.sql and runs it against
// DATABASE_URL_UNPOOLED via @neondatabase/serverless WebSocket Pool.
//
// Why this instead of `drizzle-kit migrate`: the initial migration is
// hand-authored (RLS policies, FORCE ROW LEVEL SECURITY, REVOKE, plpgsql
// trigger) and drizzle-kit generate doesn't emit those. The proper tooling
// path (generate-then-augment) is a follow-up for Run B / a later migration
// task — this script handles the bootstrap.
//
// Usage:
//   node --env-file=.env.local scripts/apply-migration.mjs 0000_init
//   node --env-file=.env.local scripts/apply-migration.mjs 0000_init.down

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const name = process.argv[2];
if (!name) {
  console.error("Usage: node scripts/apply-migration.mjs <migration-name>");
  console.error("Example: node scripts/apply-migration.mjs 0000_init");
  process.exit(1);
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error(
    "Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set. " +
      "Run with: node --env-file=.env.local scripts/apply-migration.mjs <name>",
  );
  process.exit(1);
}

const file = resolve(`drizzle/${name}.sql`);
const sql = await readFile(file, "utf8");

console.log(`Applying ${file} against ${maskUrl(url)} ...`);

const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  // Run the entire SQL file as a single multi-statement query.
  // Postgres handles plpgsql function bodies (the trigger function in 0000_init.sql)
  // correctly because the $$ … $$ dollar-quoting is preserved verbatim.
  await client.query(sql);
  console.log("OK");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

function maskUrl(u) {
  try {
    const parsed = new URL(u);
    parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<unparseable url>";
  }
}
