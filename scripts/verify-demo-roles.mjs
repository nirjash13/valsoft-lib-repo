#!/usr/bin/env node
// One-off: verifies the seeded demo users have the expected role + status
// in the live database. Read-only.

import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED missing");
  process.exit(1);
}

const TARGETS = [
  { email: "admin@stack-public.demo", expectedRole: "tenant_admin" },
  { email: "librarian@stack-public.demo", expectedRole: "librarian" },
  { email: "ada@stack-public.demo", expectedRole: "member" },
];

const pool = new Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
try {
  const emails = TARGETS.map((t) => t.email);
  const res = await c.query(
    `SELECT m.email, m.role, m.status, m.auth0_user_id, m.deleted_at,
            t.name AS tenant_name, t.id AS tenant_id
       FROM members m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE lower(m.email) = ANY($1::text[])
      ORDER BY m.email`,
    [emails],
  );

  const byEmail = new Map(res.rows.map((r) => [r.email.toLowerCase(), r]));

  console.log("\nDemo-user role verification");
  console.log("─".repeat(80));
  let allOk = true;
  for (const target of TARGETS) {
    const row = byEmail.get(target.email.toLowerCase());
    if (!row) {
      console.log(`✗ ${target.email}  — NOT FOUND in members table`);
      allOk = false;
      continue;
    }
    const roleOk = row.role === target.expectedRole;
    const statusOk = row.status === "active";
    const linkedOk = row.auth0_user_id !== null;
    const softDeletedOk = row.deleted_at === null;
    const allFlags = roleOk && statusOk && linkedOk && softDeletedOk;
    if (!allFlags) allOk = false;

    console.log(
      `${allFlags ? "✓" : "✗"} ${target.email.padEnd(32)} role=${row.role.padEnd(12)} status=${row.status.padEnd(10)} auth0_linked=${linkedOk ? "yes" : "NO "} deleted=${row.deleted_at ? "YES" : "no "}  tenant=${row.tenant_name}`,
    );
    if (!roleOk)       console.log(`     ↳ expected role: ${target.expectedRole}, got: ${row.role}`);
    if (!statusOk)     console.log(`     ↳ expected status: active, got: ${row.status}`);
    if (!linkedOk)     console.log(`     ↳ auth0_user_id is NULL — first-login bootstrap not yet completed`);
    if (!softDeletedOk) console.log(`     ↳ row is soft-deleted at ${row.deleted_at}`);
  }
  console.log("─".repeat(80));
  console.log(allOk ? "All three accounts look correct.\n" : "One or more accounts are misconfigured. See above.\n");
} finally {
  c.release();
  await pool.end();
}
