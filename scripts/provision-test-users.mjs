#!/usr/bin/env node
// scripts/provision-test-users.mjs
//
// Creates Auth0 users for the seeded demo members and adds them to the
// configured Auth0 Organization. Credentials are written to
// docs/user-data/demo-test-credentials.csv (gitignored) so they can be
// distributed to testers out-of-band.
//
// Idempotent:
//   - Existing Auth0 users matched by email are reused (password is NOT reset).
//   - Users already in the org are skipped on the add-to-org step.
//   - Newly created users get a freshly generated strong password written to
//     the CSV. Pre-existing users are emitted with password column blank — the
//     operator is expected to have those passwords from a previous run.
//
// Prerequisites (one-time Auth0 setup):
//   1. Auth0 Dashboard → Applications → Create Application
//      → Machine to Machine, name e.g. "Stack Provisioning M2M"
//      → Authorize for the Auth0 Management API
//      → Grant scopes: read:users, create:users, update:users,
//                       read:organization_members, create:organization_members,
//                       read:organization_connections
//   2. Copy the M2M client_id and client_secret into .env.local as
//        AUTH0_MGMT_CLIENT_ID=...
//        AUTH0_MGMT_CLIENT_SECRET=...
//   3. Ensure the org's Database connection allows Auth0 to set initial
//      passwords (default for Username-Password-Authentication).
//
// Usage:
//   node --env-file=.env.local scripts/provision-test-users.mjs
//   node --env-file=.env.local scripts/provision-test-users.mjs --roles=member
//   node --env-file=.env.local scripts/provision-test-users.mjs --dry-run
//
// Flags:
//   --roles=<csv>   Only provision the listed roles (member, librarian,
//                    tenant_admin). Default: all active roles.
//   --dry-run       Resolve users + org but make no Auth0 writes. Useful for
//                    sanity-checking the config before provisioning.
//   --connection=<name>
//                   Database connection name. Default:
//                    Username-Password-Authentication.

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN; // e.g. dev-xxxxx.us.auth0.com (no scheme)
const MGMT_CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID;
const MGMT_CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET;
const ORG_ID = process.env.AUTH0_ORG; // e.g. org_Hkq7N9BnKLmtqMeR

const REQUIRED_ENV = {
  AUTH0_DOMAIN,
  AUTH0_MGMT_CLIENT_ID: MGMT_CLIENT_ID,
  AUTH0_MGMT_CLIENT_SECRET: MGMT_CLIENT_SECRET,
  AUTH0_ORG: ORG_ID,
};
for (const [k, v] of Object.entries(REQUIRED_ENV)) {
  if (!v) {
    console.error(`ERROR: ${k} is not set in the environment`);
    process.exit(1);
  }
}

// Parse flags
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.startsWith("--") ? a.slice(2).split("=") : [a, ""];
    return [k, v ?? ""];
  }),
);
const DRY_RUN = args.has("dry-run");
const RESET_PASSWORDS = args.has("reset-passwords");
const CONNECTION = args.get("connection") || "Username-Password-Authentication";
const ROLE_FILTER = args.get("roles")?.split(",").filter(Boolean) ?? null;

// Throttle to stay under Auth0 free-tier global rate limit. The free tier caps
// at ~2 req/s across all Management API endpoints; 250ms between calls is safe.
const THROTTLE_MS = 300;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Test user catalog
//
// Mirrors the active rows in scripts/seed-demo.mjs DEMO_MEMBERS. Pending and
// suspended members are intentionally excluded — they exist in the DB to
// exercise the approval queue UI, not to be tested via login.
//
// Keep this list in sync with seed-demo.mjs when new active members are added.
// ---------------------------------------------------------------------------

const TEST_USERS = [
  { email: "admin@stack-public.demo", displayName: "Avery Administrator", role: "tenant_admin" },
  { email: "librarian@stack-public.demo", displayName: "Lena Librarian", role: "librarian" },
  { email: "marcus@stack-public.demo", displayName: "Marcus Reyes", role: "librarian" },
  { email: "ada@stack-public.demo", displayName: "Ada Lovelace", role: "member" },
  { email: "alan@stack-public.demo", displayName: "Alan Turing", role: "member" },
  { email: "grace@stack-public.demo", displayName: "Grace Hopper", role: "member" },
  { email: "claude@stack-public.demo", displayName: "Claude Shannon", role: "member" },
  { email: "emmy@stack-public.demo", displayName: "Emmy Noether", role: "member" },
  { email: "richard@stack-public.demo", displayName: "Richard Feynman", role: "member" },
  { email: "marie@stack-public.demo", displayName: "Marie Curie", role: "member" },
  { email: "nikola@stack-public.demo", displayName: "Nikola Tesla", role: "member" },
  { email: "dorothy@stack-public.demo", displayName: "Dorothy Vaughan", role: "member" },
  { email: "katherine@stack-public.demo", displayName: "Katherine Johnson", role: "member" },
];

const filtered = ROLE_FILTER ? TEST_USERS.filter((u) => ROLE_FILTER.includes(u.role)) : TEST_USERS;

// ---------------------------------------------------------------------------
// Auth0 Management API client
// ---------------------------------------------------------------------------

const baseUrl = `https://${AUTH0_DOMAIN}`;

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
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch Management API token: ${res.status} ${body}`);
  }
  const { access_token } = await res.json();
  return access_token;
}

/**
 * Resolves the AUTH0_ORG env value to an Auth0 organization id (org_...).
 *
 * - If the value already starts with "org_", returns it as-is.
 * - Otherwise treats it as the org "name" (slug) and looks up the id via
 *   GET /api/v2/organizations/name/{name}.
 *
 * The /organizations/{id}/members endpoint rejects names, so we must convert
 * before using it.
 */
async function resolveOrgId(token, orgEnvValue) {
  if (orgEnvValue.startsWith("org_")) return orgEnvValue;
  const url = `${baseUrl}/api/v2/organizations/name/${encodeURIComponent(orgEnvValue)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Could not resolve AUTH0_ORG="${orgEnvValue}" via /organizations/name/: ${res.status} ${body}`,
    );
  }
  const org = await res.json();
  if (!org.id) throw new Error(`Organization "${orgEnvValue}" returned no id`);
  return org.id;
}

async function findUserByEmail(token, email) {
  const url = `${baseUrl}/api/v2/users-by-email?email=${encodeURIComponent(email.toLowerCase())}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`users-by-email failed for ${email}: ${res.status} ${body}`);
  }
  const users = await res.json();
  // Prefer a user from the requested connection if multiple exist.
  return (
    users.find((u) => u.identities?.some((i) => i.connection === CONNECTION)) ?? users[0] ?? null
  );
}

async function createUser(token, { email, displayName }) {
  const password = generatePassword();
  const res = await fetch(`${baseUrl}/api/v2/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: email.toLowerCase(),
      password,
      connection: CONNECTION,
      name: displayName,
      email_verified: true, // skip the confirmation hop for demo accounts
      verify_email: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createUser failed for ${email}: ${res.status} ${body}`);
  }
  const user = await res.json();
  return { user, password };
}

/**
 * Resets the password on an existing Auth0 user. Used by --reset-passwords to
 * recover from a prior failed run where the generated password was lost
 * because a later step (e.g. addUserToOrg) threw before we wrote the CSV.
 */
async function resetUserPassword(token, userId) {
  const password = generatePassword();
  const res = await fetch(`${baseUrl}/api/v2/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password, connection: CONNECTION }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`resetUserPassword failed for ${userId}: ${res.status} ${body}`);
  }
  return password;
}

async function addUserToOrg(token, orgId, userId) {
  const res = await fetch(`${baseUrl}/api/v2/organizations/${orgId}/members`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ members: [userId] }),
  });
  // 204 No Content on success. 409 if already a member — treat as success.
  if (res.status === 204) return { added: true };
  if (res.status === 409) return { added: false, reason: "already_member" };
  const body = await res.text();
  // Some Auth0 tenants return 400 with "already a member" — tolerate it.
  if (body.toLowerCase().includes("already")) return { added: false, reason: "already_member" };
  throw new Error(`addUserToOrg failed for ${userId}: ${res.status} ${body}`);
}

function generatePassword() {
  // 16 bytes → 22 base64url chars + a digit + a symbol → meets Auth0's default
  // password policy (8+ chars, upper, lower, digit, special).
  const raw = randomBytes(16).toString("base64url");
  return `${raw}9!`;
}

// ---------------------------------------------------------------------------
// CSV writer
// ---------------------------------------------------------------------------

function writeCsv(rows) {
  const here = dirname(fileURLToPath(import.meta.url));
  const target = resolve(here, "..", "docs", "user-data", "demo-test-credentials.csv");
  mkdirSync(dirname(target), { recursive: true });

  const header = "email,display_name,role,password,status";
  const lines = rows.map(
    (r) =>
      `${r.email},${csvEscape(r.displayName)},${r.role},${r.password ?? ""},${r.status}`,
  );
  writeFileSync(target, `${header}\n${lines.join("\n")}\n`, "utf8");
  return target;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`provision-test-users: domain=${AUTH0_DOMAIN} org=${ORG_ID}`);
  console.log(`  connection: ${CONNECTION}`);
  console.log(`  users to process: ${filtered.length}`);
  if (DRY_RUN) console.log("  (dry-run — no writes)");
  if (RESET_PASSWORDS) console.log("  --reset-passwords: existing users WILL have passwords reset");

  const token = DRY_RUN ? "dry-run-token" : await getMgmtToken();

  // Resolve org slug → id once up front. The /organizations/{id}/members endpoint
  // rejects names, and validating early surfaces the misconfig before we create users.
  const resolvedOrgId = DRY_RUN ? ORG_ID : await resolveOrgId(token, ORG_ID);
  if (!DRY_RUN && resolvedOrgId !== ORG_ID) {
    console.log(`  resolved AUTH0_ORG "${ORG_ID}" → ${resolvedOrgId}`);
  }

  const results = [];
  for (const u of filtered) {
    if (DRY_RUN) {
      results.push({ ...u, password: "(dry-run)", status: "would_provision" });
      console.log(`  [dry] ${u.email} (${u.role})`);
      continue;
    }

    // Per-iteration carry — preserves the generated password across the try/catch
    // so a later step's failure does not erase it from the CSV.
    let user = null;
    let password = null;
    let status = "unknown";

    try {
      user = await findUserByEmail(token, u.email);
      await sleep(THROTTLE_MS);

      if (user) {
        if (RESET_PASSWORDS) {
          password = await resetUserPassword(token, user.user_id);
          status = "password_reset";
          console.log(`  ~ ${u.email} — password reset (${user.user_id})`);
          await sleep(THROTTLE_MS);
        } else {
          status = "exists";
          console.log(`  · ${u.email} — user exists (${user.user_id})`);
        }
      } else {
        const created = await createUser(token, u);
        user = created.user;
        password = created.password;
        status = "created";
        console.log(`  + ${u.email} — created (${user.user_id})`);
        await sleep(THROTTLE_MS);
      }

      const orgResult = await addUserToOrg(token, resolvedOrgId, user.user_id);
      if (orgResult.added) {
        console.log(`    └─ added to org`);
        status = status === "created" ? "created+added" : `${status}+added`;
      } else {
        console.log(`    └─ already in org`);
      }
      await sleep(THROTTLE_MS);

      results.push({ ...u, password, status });
    } catch (err) {
      console.error(`  ! ${u.email} — ${err.message}`);
      results.push({
        ...u,
        password, // preserve any password generated this iteration
        status: `error: ${err.message.slice(0, 120)}`,
      });
    }
  }

  const csvPath = writeCsv(results);
  console.log(`\nCredentials written to: ${csvPath}`);
  console.log("Distribute that file out-of-band — it is gitignored under docs/.");

  const createdCount = results.filter((r) => r.status.startsWith("created")).length;
  const resetCount = results.filter((r) => r.status.startsWith("password_reset")).length;
  const existedCount = results.filter((r) => r.status === "exists" || r.status === "exists+added")
    .length;
  const errorCount = results.filter((r) => r.status.startsWith("error")).length;
  console.log(
    `\nSummary: created=${createdCount} reset=${resetCount} existed=${existedCount} errors=${errorCount} total=${results.length}`,
  );
  if (errorCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
