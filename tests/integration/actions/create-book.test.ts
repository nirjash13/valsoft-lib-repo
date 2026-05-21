/**
 * Integration test: createBook domain function.
 *
 * Requires DATABASE_URL pointing at a Neon test branch with migrations
 * 0000–0004 applied (run: pnpm db:apply 0004).
 *
 * Load-bearing:
 *   1. Happy path: insert writes books row + audit_log row atomically in same tx.
 *   2. Cross-tenant probe: as tenant B, direct SELECT for tenant A's book returns
 *      0 rows (RLS isolation enforced by assert_tenant()).
 *
 * These tests do NOT run in unit test mode — skip if DATABASE_URL is absent.
 */

import { randomUUID } from "node:crypto";
import { createBook } from "@/lib/domain/books/create-book";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

// ---------------------------------------------------------------------------
// Setup: skip if DATABASE_URL is not configured
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_UNPOOLED = process.env.DATABASE_URL_UNPOOLED;
const DATABASE_URL_APP_DIRECT = process.env.DATABASE_URL_APP_DIRECT;

if (!DATABASE_URL || !DATABASE_URL_UNPOOLED || !DATABASE_URL_APP_DIRECT) {
  describe.skip("createBook (integration — requires DATABASE_URL)", () => {
    it("skipped: set DATABASE_URL, DATABASE_URL_UNPOOLED, DATABASE_URL_APP_DIRECT in .env.local", () => {});
  });
} else {
  // Pools
  const ownerPool = new Pool({ connectionString: DATABASE_URL_UNPOOLED });
  const appPool = new Pool({ connectionString: DATABASE_URL_APP_DIRECT });

  // Tenant UUIDs seeded for this test run
  let tenantA: string;
  let tenantB: string;
  let testBookId: string | undefined;

  beforeAll(async () => {
    tenantA = randomUUID();
    tenantB = randomUUID();

    const owner = await ownerPool.connect();
    try {
      await owner.query(
        `INSERT INTO tenants (id, auth0_org_id, name, slug)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        [
          tenantA,
          `org_cb_test_${tenantA.slice(0, 8)}`,
          "Create Book Test A",
          `cb-test-a-${tenantA.slice(0, 8)}`,
          tenantB,
          `org_cb_test_${tenantB.slice(0, 8)}`,
          "Create Book Test B",
          `cb-test-b-${tenantB.slice(0, 8)}`,
        ],
      );
    } finally {
      owner.release();
    }
  });

  afterAll(async () => {
    const owner = await ownerPool.connect();
    try {
      // Cleanup: remove in FK-safe order.
      //
      // audit_log has a BEFORE-DELETE trigger (audit_log_no_delete) that raises
      // unconditionally for every role, including neondb_owner. Disable the
      // trigger as the owner before deleting, then re-enable it. This is the
      // only reliable cleanup path — the trigger is DDL-guarded, not role-guarded.
      //
      // Order:
      //   1. Disable append-only guard on audit_log
      //   2. DELETE audit_log rows (books→audit_log FK is ON DELETE RESTRICT)
      //   3. DELETE books rows (tenants→books FK is ON DELETE RESTRICT)
      //   4. DELETE tenants rows
      //   5. Re-enable trigger
      await owner.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete");
      await owner.query("DELETE FROM audit_log WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
      await owner.query("DELETE FROM books WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
      await owner.query("DELETE FROM tenants WHERE id IN ($1, $2)", [tenantA, tenantB]);
      await owner.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete");
    } finally {
      owner.release();
    }
    await ownerPool.end();
    await appPool.end();
  });

  describe("createBook (integration)", () => {
    it("inserts a books row and an audit_log row atomically (happy path)", async () => {
      const ctx = { tenantId: tenantA, userId: "test-user-librarian" };
      const input = {
        title: "Clean Code",
        authors: ["Robert C. Martin"],
        isbn13: "9780132350884",
        year: 2008,
      };

      // Use withTenantTx to set app.tenant_id (required by RLS)
      const { withTenantTx } = await import("@/lib/db/with-tenant-tx");
      // We swap the db module's pool to our test pool by injecting via env.
      // Since db/client.ts reads DATABASE_URL at import time and we set it
      // before importing, the drizzle instance in db uses the test branch URL.
      const result = await withTenantTx(ctx, async (tx, txCtx) => {
        return createBook(tx, txCtx, input);
      });

      expect(result.id).toBeDefined();
      testBookId = result.id;

      // Verify audit_log row was written in the same transaction
      const owner = await ownerPool.connect();
      try {
        const { rows: auditRows } = await owner.query(
          "SELECT action, subject_type, subject_id FROM audit_log WHERE subject_id = $1::uuid",
          [result.id],
        );
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0].action).toBe("book.created");
        expect(auditRows[0].subject_type).toBe("book");
      } finally {
        owner.release();
      }
    });

    it("RLS cross-tenant probe: as tenant B, SELECT for tenant A book returns 0 rows", async () => {
      // This test requires testBookId from the happy-path test above.
      // Vitest runs tests in order within a describe block.
      if (!testBookId) {
        // If the previous test failed, skip this probe gracefully
        return;
      }

      const app = await appPool.connect();
      try {
        await app.query("BEGIN");
        // Bind to tenant B — RLS will enforce assert_tenant() = tenantB
        await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);

        // Direct SELECT by primary key from tenant A — should return 0 rows
        const { rows } = await app.query("SELECT id FROM books WHERE id = $1", [testBookId]);
        await app.query("COMMIT");

        expect(rows).toHaveLength(0);
      } finally {
        app.release();
      }
    });
  });
}
