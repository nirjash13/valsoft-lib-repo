#!/usr/bin/env node
// scripts/verify-foundation.mjs
//
// Smoke-verifies the Spec 01 Run A foundation against a real Neon branch.
// Uses TWO connections to model the production split:
//   - OWNER (DATABASE_URL_UNPOOLED, neondb_owner, BYPASSRLS=true)
//       Used for: pg catalog inspection, tenant + cross-tenant data seeding.
//   - APP   (DATABASE_URL_APP_DIRECT, stack_app, NOBYPASSRLS)
//       Used for: every RLS / assert_tenant / trigger assertion.
//
// What this verifies (failures here = critical foundation bugs):
//   1. RLS enabled + FORCED on tenant_memberships, members, audit_log, tenants (Run B+)
//   2. audit_log triggers (no_update, no_delete) exist
//   3. stack_app exists and has NOBYPASSRLS (RLS will actually apply)
//   4. members query as stack_app without app.tenant_id set raises (REQ-01-10)
//   5. set_config + members query as stack_app is isolated to the bound tenant
//   6. audit_log UPDATE as stack_app raises 'append-only' (NFR-01-03)
//   7. audit_log DELETE as stack_app raises 'append-only' (NFR-01-03)
//   8. [Run B] tenants RLS: bound to tenant A, SELECT returns only tenant A (cross-tenant probe)
//   9. [Run B] tenants RLS: bound to tenant A, UPDATE of tenant B's row affects 0 rows
//  10. [Run B] tenants RLS: bound to tenant A, SELECT of tenant B's id returns 0 rows
//  11. [Run B-fix] org_id → UUID resolver: SELECT id FROM tenants WHERE auth0_org_id = $1
//      (the CRITICAL fix: proves the lookup that resolveTenantIdByAuth0Org relies on works)
//
// Usage: pnpm run db:verify

import { randomUUID } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const ownerUrl = process.env.DATABASE_URL_UNPOOLED;
const appUrl = process.env.DATABASE_URL_APP_DIRECT;
if (!ownerUrl) {
  console.error("Set DATABASE_URL_UNPOOLED in .env.local (neondb_owner direct connection)");
  process.exit(1);
}
if (!appUrl) {
  console.error("Set DATABASE_URL_APP_DIRECT in .env.local (stack_app direct connection)");
  process.exit(1);
}

const ownerPool = new Pool({ connectionString: ownerUrl });
const appPool = new Pool({ connectionString: appUrl });
const results = [];

function record(name, status, detail = "") {
  results.push({ name, status, detail });
  const flag = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "WARN";
  console.log(`[${flag}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function check(name, fn) {
  try {
    await fn();
    record(name, "PASS");
  } catch (err) {
    record(name, "FAIL", err.message);
  }
}

async function expectThrows(promise, pattern) {
  try {
    await promise;
    throw new Error("expected error but query succeeded");
  } catch (err) {
    if (!pattern.test(err.message)) {
      throw new Error(`error matched wrong pattern: ${err.message}`);
    }
  }
}

const owner = await ownerPool.connect();
const app = await appPool.connect();

try {
  // ----------------------------------------------------------------------------
  // 1. RLS + FORCE on tenant tables; not on tenants
  // ----------------------------------------------------------------------------
  await check(
    "RLS enabled + FORCED on tenant_memberships, members, audit_log, tenants",
    async () => {
      const { rows } = await owner.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
         WHERE relname IN ('tenant_memberships','members','audit_log','tenants')`,
      );
      const byName = Object.fromEntries(rows.map((r) => [r.relname, r]));
      for (const t of ["tenant_memberships", "members", "audit_log", "tenants"]) {
        if (!byName[t]?.relrowsecurity) throw new Error(`${t} missing RLS`);
        if (!byName[t]?.relforcerowsecurity) throw new Error(`${t} missing FORCE`);
      }
    },
  );

  // ----------------------------------------------------------------------------
  // 2. audit_log triggers exist
  // ----------------------------------------------------------------------------
  await check("audit_log triggers (no_update, no_delete) exist", async () => {
    const { rows } = await owner.query(
      `SELECT tgname FROM pg_trigger
         WHERE tgrelid = 'audit_log'::regclass AND NOT tgisinternal`,
    );
    const names = new Set(rows.map((r) => r.tgname));
    if (!names.has("audit_log_no_update")) throw new Error("audit_log_no_update missing");
    if (!names.has("audit_log_no_delete")) throw new Error("audit_log_no_delete missing");
  });

  // ----------------------------------------------------------------------------
  // 3. stack_app role exists and has NOBYPASSRLS
  // ----------------------------------------------------------------------------
  await check("stack_app role exists with NOBYPASSRLS", async () => {
    const { rows } = await owner.query(
      `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'stack_app'`,
    );
    if (rows.length === 0) throw new Error("stack_app role does not exist");
    if (rows[0].rolbypassrls) throw new Error("stack_app has BYPASSRLS — RLS would not apply");
    if (rows[0].rolsuper) throw new Error("stack_app is SUPERUSER — RLS would not apply");
  });

  // Seed two tenants (tenants has no RLS) + one member per tenant (owner bypasses RLS).
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  await owner.query(
    `INSERT INTO tenants (id, auth0_org_id, name, slug)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
    [
      tenantA,
      `org_verify_${tenantA}`,
      "Verify A",
      `verify-a-${tenantA.slice(0, 8)}`,
      tenantB,
      `org_verify_${tenantB}`,
      "Verify B",
      `verify-b-${tenantB.slice(0, 8)}`,
    ],
  );
  await owner.query(
    `INSERT INTO members (tenant_id, display_name, email)
       VALUES ($1, $2, $3), ($4, $5, $6)
       ON CONFLICT DO NOTHING`,
    [
      tenantA,
      "Alice A",
      `alice-${tenantA.slice(0, 8)}@verify.test`,
      tenantB,
      "Bob B",
      `bob-${tenantB.slice(0, 8)}@verify.test`,
    ],
  );

  // ----------------------------------------------------------------------------
  // 4. AS STACK_APP — members query without app.tenant_id raises (REQ-01-10)
  //    With at least one row in members, the RLS policy's USING(tenant_id =
  //    assert_tenant()) evaluates per row, calls assert_tenant(), which raises
  //    because app.tenant_id is unset.
  // ----------------------------------------------------------------------------
  await check(
    "as stack_app: members query without app.tenant_id raises (assert_tenant)",
    async () => {
      await app.query("BEGIN");
      try {
        await expectThrows(
          app.query("SELECT * FROM members"),
          /app\.tenant_id is not set|bypassed withTenantTx|insufficient_privilege/i,
        );
      } finally {
        await app.query("ROLLBACK");
      }
    },
  );

  // ----------------------------------------------------------------------------
  // 5. AS STACK_APP — set_config + members query is isolated to bound tenant
  // ----------------------------------------------------------------------------
  await check("as stack_app: set_config isolates members to bound tenant", async () => {
    await app.query("BEGIN");
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
    const a = await app.query("SELECT tenant_id FROM members");
    await app.query("COMMIT");

    if (a.rowCount === 0) {
      throw new Error("tenant A sees zero members of its own (seeding failed?)");
    }
    const leaked = a.rows.filter((r) => r.tenant_id !== tenantA);
    if (leaked.length > 0) {
      throw new Error(`tenant A saw ${leaked.length} row(s) from a different tenant — RLS LEAK`);
    }
  });

  // Also verify the reverse: tenant B sees only its own rows.
  await check("as stack_app: tenant B sees only its own members (reverse check)", async () => {
    await app.query("BEGIN");
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
    const b = await app.query("SELECT tenant_id FROM members");
    await app.query("COMMIT");

    if (b.rowCount === 0) {
      throw new Error("tenant B sees zero members of its own");
    }
    const leaked = b.rows.filter((r) => r.tenant_id !== tenantB);
    if (leaked.length > 0) {
      throw new Error(`tenant B saw ${leaked.length} row(s) from tenant A — bidirectional leak`);
    }
  });

  // Seed a membership row so the tenants RLS membership policy can resolve.
  // We need app.user_id to match a tenant_memberships row for the policy to allow the read.
  const userA = `verify-user-${tenantA.slice(0, 8)}`;
  const userB = `verify-user-${tenantB.slice(0, 8)}`;
  await owner.query(
    `INSERT INTO tenant_memberships (tenant_id, user_id, role, status)
       VALUES ($1, $2, 'tenant_admin', 'active'), ($3, $4, 'tenant_admin', 'active')
       ON CONFLICT DO NOTHING`,
    [tenantA, userA, tenantB, userB],
  );

  // ----------------------------------------------------------------------------
  // 8. [Run B] tenants RLS: tenant A user sees only their own tenant row
  //    NFR-01-02 cross-tenant probe — tenants table
  // ----------------------------------------------------------------------------
  await check("[Run B] as stack_app: tenants RLS — tenant A sees only its own row", async () => {
    await app.query("BEGIN");
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
    await app.query(`SELECT set_config('app.user_id', $1, true)`, [userA]);
    const result = await app.query("SELECT id FROM tenants");
    await app.query("COMMIT");

    if (result.rowCount === 0) {
      throw new Error(
        "tenant A user sees 0 tenants — RLS is too restrictive (membership seed failed?)",
      );
    }
    const leaked = result.rows.filter((r) => r.id !== tenantA);
    if (leaked.length > 0) {
      throw new Error(
        `tenant A user saw ${leaked.length} row(s) from other tenants — RLS LEAK on tenants table`,
      );
    }
  });

  // ----------------------------------------------------------------------------
  // 9. [Run B] tenants RLS: bound to tenant A, UPDATE of tenant B's row affects 0 rows
  //    A successful cross-tenant UPDATE would mean data corruption.
  // ----------------------------------------------------------------------------
  await check(
    "[Run B] as stack_app: tenants RLS — tenant A cannot UPDATE tenant B's row",
    async () => {
      await app.query("BEGIN");
      await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await app.query(`SELECT set_config('app.user_id', $1, true)`, [userA]);
      const result = await app.query(
        `UPDATE tenants SET name = 'HACKED' WHERE id = $1 RETURNING id`,
        [tenantB],
      );
      await app.query("ROLLBACK");

      if (result.rowCount !== 0) {
        throw new Error(
          `tenant A was able to UPDATE tenant B's row — RLS LEAK (${result.rowCount} rows affected)`,
        );
      }
    },
  );

  // ----------------------------------------------------------------------------
  // 10. [Run B] tenants RLS: bound to tenant A, SELECT of tenant B's id returns 0 rows
  //     Direct id lookup must not bypass tenant isolation.
  // ----------------------------------------------------------------------------
  await check(
    "[Run B] as stack_app: tenants RLS — tenant A cannot SELECT tenant B's row by id",
    async () => {
      await app.query("BEGIN");
      await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await app.query(`SELECT set_config('app.user_id', $1, true)`, [userA]);
      const result = await app.query("SELECT id FROM tenants WHERE id = $1", [tenantB]);
      await app.query("COMMIT");

      if (result.rowCount !== 0) {
        throw new Error(`tenant A was able to SELECT tenant B's row by id — RLS LEAK`);
      }
    },
  );

  // ----------------------------------------------------------------------------
  // 6 + 7. AS STACK_APP — audit_log UPDATE/DELETE raise via trigger
  // ----------------------------------------------------------------------------
  await check("as stack_app: audit_log UPDATE raises 'append-only'", async () => {
    await app.query("BEGIN");
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
    const ins = await app.query(
      `INSERT INTO audit_log (tenant_id, actor_id, action, subject_type)
         VALUES ($1, 'verify-user', 'test.event', 'verify') RETURNING id`,
      [tenantA],
    );
    const auditId = ins.rows[0].id;
    await expectThrows(
      app.query("UPDATE audit_log SET action = 'changed' WHERE id = $1", [auditId]),
      /append-only/i,
    );
    await app.query("ROLLBACK");
  });

  await check("as stack_app: audit_log DELETE raises 'append-only'", async () => {
    await app.query("BEGIN");
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
    await app.query(
      `INSERT INTO audit_log (tenant_id, actor_id, action, subject_type)
         VALUES ($1, 'verify-user', 'test.event2', 'verify')`,
      [tenantA],
    );
    await expectThrows(
      app.query("DELETE FROM audit_log WHERE action = 'test.event2'"),
      /append-only/i,
    );
    await app.query("ROLLBACK");
  });

  // ----------------------------------------------------------------------------
  // 11. [Run B-fix] org_id → UUID resolver: resolveTenantIdByAuth0Org returns the
  //     UUID that was seeded above, not the Auth0 org string. This is the integration
  //     proof that the CRITICAL resolver path works end-to-end.
  //     Uses the owner connection directly (matches what resolveTenantIdByAuth0Org does).
  // ----------------------------------------------------------------------------
  await check(
    "[Run B-fix] org_id → UUID resolver: SELECT id FROM tenants WHERE auth0_org_id = $1",
    async () => {
      const orgIdA = `org_verify_${tenantA}`;
      const { rows } = await owner.query("SELECT id FROM tenants WHERE auth0_org_id = $1 LIMIT 1", [
        orgIdA,
      ]);
      if (rows.length === 0) {
        throw new Error(
          `No tenant row found for auth0_org_id='${orgIdA}' — resolver would return TenantNotProvisionedError`,
        );
      }
      if (rows[0].id !== tenantA) {
        throw new Error(`Resolver returned wrong UUID: expected ${tenantA}, got ${rows[0].id}`);
      }
      // Verify a non-existent org returns 0 rows (resolver would throw TenantNotProvisionedError)
      const { rows: missing } = await owner.query(
        "SELECT id FROM tenants WHERE auth0_org_id = $1 LIMIT 1",
        ["org_does_not_exist"],
      );
      if (missing.length !== 0) {
        throw new Error("Query for non-existent org_id returned a row — impossible");
      }
    },
  );

  // ----------------------------------------------------------------------------
  // Cleanup (owner connection — bypasses RLS).
  // ----------------------------------------------------------------------------
  await owner.query("DELETE FROM members WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
  await owner.query("DELETE FROM tenant_memberships WHERE tenant_id IN ($1, $2)", [
    tenantA,
    tenantB,
  ]);
  // audit_log rollback'd above so nothing to clean there.
  // Tenants left in place — they're harmless and useful for debugging if needed.

  console.log("");
  const failures = results.filter((r) => r.status === "FAIL");
  if (failures.length === 0) {
    console.log(`PASS: ${results.length}/${results.length} checks passed`);
  } else {
    console.log(`FAIL: ${failures.length} of ${results.length} checks failed`);
    process.exitCode = 1;
  }
} finally {
  owner.release();
  app.release();
  await ownerPool.end();
  await appPool.end();
}
