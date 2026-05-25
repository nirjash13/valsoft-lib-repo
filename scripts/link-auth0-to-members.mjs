#!/usr/bin/env node
// scripts/link-auth0-to-members.mjs
//
// Populates members.auth0_user_id for seeded demo accounts by looking up each
// user in Auth0 (by email) and writing the resulting sub back to the matching
// members row in the tenant resolved from AUTH0_ORG.
//
// WHY: The app's member-self-service pages (My Loans, My Holds, My Profile)
// resolve the current member via `getMemberByUserId(sub)` — a strict match on
// `members.auth0_user_id`. The first-login bootstrap that was supposed to write
// that linkage on a member's first sign-in does not happen automatically, so
// freshly seeded users show "Your member account is not yet linked to your
// login." This script repairs that state idempotently.
//
// Idempotent:
//   - Skips members already linked to the correct sub
//   - Warns (but does not overwrite) members linked to a DIFFERENT sub
//   - Tolerates Auth0 rate limits with a small throttle
//
// Required env (same as provision-test-users.mjs, plus DB):
//   AUTH0_DOMAIN, AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET, AUTH0_ORG
//   DATABASE_URL_UNPOOLED
//
// Usage:
//   node --env-file=.env.local scripts/link-auth0-to-members.mjs
//   node --env-file=.env.local scripts/link-auth0-to-members.mjs --dry-run

import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const MGMT_CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID;
const MGMT_CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET;
const ORG_ID_ENV = process.env.AUTH0_ORG;
const DB_URL = process.env.DATABASE_URL_UNPOOLED;

for (const [k, v] of Object.entries({
  AUTH0_DOMAIN,
  AUTH0_MGMT_CLIENT_ID: MGMT_CLIENT_ID,
  AUTH0_MGMT_CLIENT_SECRET: MGMT_CLIENT_SECRET,
  AUTH0_ORG: ORG_ID_ENV,
  DATABASE_URL_UNPOOLED: DB_URL,
})) {
  if (!v) {
    console.error(`ERROR: ${k} is not set in the environment`);
    process.exit(1);
  }
}

const DRY_RUN = process.argv.includes("--dry-run");
const CONNECTION = "Username-Password-Authentication";
const THROTTLE_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseUrl = `https://${AUTH0_DOMAIN}`;

// Demo users — kept in sync with provision-test-users.mjs
const EMAILS = [
  "admin@stack-public.demo",
  "librarian@stack-public.demo",
  "marcus@stack-public.demo",
  "ada@stack-public.demo",
  "alan@stack-public.demo",
  "grace@stack-public.demo",
  "claude@stack-public.demo",
  "emmy@stack-public.demo",
  "richard@stack-public.demo",
  "marie@stack-public.demo",
  "nikola@stack-public.demo",
  "dorothy@stack-public.demo",
  "katherine@stack-public.demo",
];

async function getMgmtToken() {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: MGMT_CLIENT_ID,
      client_secret: MGMT_CLIENT_SECRET,
      audience: `${baseUrl}/api/v2/`,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token;
}

async function resolveOrgId(token, orgEnvValue) {
  if (orgEnvValue.startsWith("org_")) return orgEnvValue;
  const res = await fetch(
    `${baseUrl}/api/v2/organizations/name/${encodeURIComponent(orgEnvValue)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`resolveOrgId: ${res.status} ${await res.text()}`);
  const org = await res.json();
  return org.id;
}

async function findUserByEmail(token, email) {
  const res = await fetch(
    `${baseUrl}/api/v2/users-by-email?email=${encodeURIComponent(email.toLowerCase())}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`users-by-email ${email}: ${res.status} ${await res.text()}`);
  const users = await res.json();
  return (
    users.find((u) => u.identities?.some((i) => i.connection === CONNECTION)) ?? users[0] ?? null
  );
}

async function main() {
  console.log(`link-auth0-to-members: domain=${AUTH0_DOMAIN} org=${ORG_ID_ENV}`);
  if (DRY_RUN) console.log("  (dry-run — no DB writes)");

  const token = await getMgmtToken();
  const orgId = await resolveOrgId(token, ORG_ID_ENV);

  const pool = new Pool({ connectionString: DB_URL, max: 1 });
  const c = await pool.connect();
  try {
    const tRes = await c.query("SELECT id, name FROM tenants WHERE auth0_org_id = $1", [orgId]);
    if (tRes.rows.length === 0) {
      console.error(`No tenant found for auth0_org_id=${orgId}`);
      process.exit(1);
    }
    const tenantId = tRes.rows[0].id;
    console.log(`  tenant: ${tRes.rows[0].name} (${tenantId})\n`);

    let linked = 0;
    let alreadyLinked = 0;
    let mismatched = 0;
    let missing = 0;

    for (const email of EMAILS) {
      const auth0User = await findUserByEmail(token, email);
      await sleep(THROTTLE_MS);

      if (!auth0User) {
        console.log(`✗ ${email.padEnd(32)} — not found in Auth0`);
        missing += 1;
        continue;
      }
      const sub = auth0User.user_id;

      const cur = await c.query(
        `SELECT id, auth0_user_id, role
           FROM members
          WHERE tenant_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL
          LIMIT 1`,
        [tenantId, email],
      );

      if (cur.rows.length === 0) {
        console.log(`✗ ${email.padEnd(32)} — no members row in tenant`);
        missing += 1;
        continue;
      }
      const row = cur.rows[0];

      if (row.auth0_user_id === sub) {
        console.log(`· ${email.padEnd(32)} — already linked (role=${row.role})`);
        alreadyLinked += 1;
        continue;
      }
      if (row.auth0_user_id !== null && row.auth0_user_id !== sub) {
        console.log(
          `! ${email.padEnd(32)} — linked to a different sub (${row.auth0_user_id}) — NOT overwritten`,
        );
        mismatched += 1;
        continue;
      }

      // auth0_user_id IS NULL → safe to link
      if (DRY_RUN) {
        console.log(`+ ${email.padEnd(32)} — would link sub=${sub} role=${row.role}`);
      } else {
        await c.query(
          `UPDATE members SET auth0_user_id = $1, updated_at = now()
            WHERE id = $2 AND auth0_user_id IS NULL`,
          [sub, row.id],
        );
        console.log(`✓ ${email.padEnd(32)} — linked sub=${sub} role=${row.role}`);
      }
      linked += 1;
    }

    console.log(
      `\nSummary: linked=${linked} already=${alreadyLinked} mismatch=${mismatched} missing=${missing} total=${EMAILS.length}`,
    );
    if (mismatched > 0 || missing > 0) process.exit(2);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
