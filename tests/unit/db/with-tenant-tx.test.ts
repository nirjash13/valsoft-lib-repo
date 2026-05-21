import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — variables that vi.mock factory references must be hoisted
// so they are initialized before the factory runs (vi.mock is hoisted to top).
// ---------------------------------------------------------------------------

const { executedSql, mockTx, mockDb } = vi.hoisted(() => {
  const executedSql: string[] = [];

  /**
   * Reconstruct a readable SQL string from the Drizzle sql`` template object.
   *
   * Drizzle's sql`` template produces an object with a `queryChunks` array where
   * each chunk is either:
   *   - An object with `value: string[]` (SQL text segment), or
   *   - A plain string/number (a bound parameter value).
   *
   * We concatenate both to get a human-readable assertion target.
   */
  function serializeSqlChunks(query: {
    queryChunks?: Array<{ value: unknown[] } | string | number | unknown>;
  }): string {
    const chunks = query.queryChunks ?? [];
    return chunks
      .map((chunk) => {
        if (typeof chunk === "string" || typeof chunk === "number") return String(chunk);
        if (chunk !== null && typeof chunk === "object" && "value" in chunk) {
          return (chunk as { value: unknown[] }).value.join("");
        }
        return "";
      })
      .join("")
      .trim();
  }

  const mockTx = {
    execute: vi.fn(
      async (query: { queryChunks?: Array<{ value: unknown[] } | string | number | unknown> }) => {
        executedSql.push(serializeSqlChunks(query));
      },
    ),
  };

  const mockDb = {
    transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
  };

  return { executedSql, mockTx, mockDb };
});

vi.mock("@/lib/db/client", () => ({ db: mockDb }));

// Import under test AFTER vi.mock so the factory runs first.
import { MissingTenantContextError, withTenantTx } from "@/lib/db/with-tenant-tx";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withTenantTx", () => {
  beforeEach(() => {
    executedSql.length = 0;
    mockDb.transaction.mockClear();
    mockTx.execute.mockClear();
  });

  it("throws MissingTenantContextError and does NOT open a transaction when tenantId is empty", async () => {
    const ctx = { tenantId: "", userId: "user_abc" };

    const act = () => withTenantTx(ctx, async () => "should-not-reach");

    await expect(act()).rejects.toThrow(MissingTenantContextError);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("binds app.tenant_id via set_config(_, _, is_local=true) as the first statement", async () => {
    const ctx = { tenantId: "tenant-uuid-123", userId: "user_abc" };

    await withTenantTx(ctx, async (_tx, _ctx) => "ok");

    // At least one SQL statement must have been executed.
    expect(executedSql.length).toBeGreaterThanOrEqual(1);
    // The very first statement must bind the tenant (not userId or any app query).
    const first = executedSql[0] ?? "";
    // Must be set_config (NOT plain `SET LOCAL …= $1`, which PG rejects as a
    // parser error, and NOT plain `SET`, which would leak across PgBouncer-
    // pooled connections per doc-04 warning).
    expect(first).toMatch(/^\s*SELECT\s+set_config\s*\(\s*'app\.tenant_id'\s*,/i);
    expect(first).toContain("tenant-uuid-123");
    // Belt-and-suspenders: never use `SET LOCAL` (PG won't accept parameterized
    // values there — proven by the verify-foundation.mjs run on 2026-05-21).
    expect(first).not.toMatch(/^\s*SET\s+LOCAL\s+app\.tenant_id/i);
    // Last belt: the is_local flag must be true so the value scopes to the
    // current transaction (matches SET LOCAL semantics under PgBouncer).
    expect(first).toMatch(/,\s*true\s*\)\s*$/);
  });

  it("throws MissingTenantContextError and does NOT open a transaction when userId is empty", async () => {
    const ctx = { tenantId: "tenant-uuid-123", userId: "" };

    const act = () => withTenantTx(ctx, async () => "should-not-reach");

    await expect(act()).rejects.toThrow(MissingTenantContextError);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
