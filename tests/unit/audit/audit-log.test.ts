import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

// We need to mock the auditLog schema table so it doesn't trigger DB module init.
// The actual insert values are what we're verifying.
const capturedInsertValues: unknown[] = [];

const mockInsertChain = {
  values: vi.fn((vals: unknown) => {
    capturedInsertValues.push(vals);
    return Promise.resolve();
  }),
};

// Drizzle tx mock: tx.insert(table).values(vals) — two-call chain
const mockTx = {
  insert: vi.fn(() => mockInsertChain),
};

// Mock the schema module so the import doesn't try to connect to DB
vi.mock("@/lib/db/schema/audit-log", () => ({
  auditLog: Symbol("auditLog"),
}));

// Import the module under test AFTER mocks are defined
import { writeAuditLog } from "@/lib/audit/audit-log";
import type { TenantCtx } from "@/lib/auth/types";
import type { TxClient } from "@/lib/db/with-tenant-tx";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("writeAuditLog", () => {
  beforeEach(() => {
    capturedInsertValues.length = 0;
    mockTx.insert.mockClear();
    mockInsertChain.values.mockClear();
  });

  it("inserts a single row with tenantId and actorId from ctx, not from entry", async () => {
    // SECURITY: tenantId + actorId come from the validated ctx, not from caller-supplied entry.
    // If the insert used entry-provided tenantId, a caller could audit-log actions against
    // another tenant — an audit trail integrity failure.
    const ctx: TenantCtx = {
      tenantId: "tenant-uuid-aaa",
      userId: "user-uuid-bbb",
    };

    await writeAuditLog(mockTx as unknown as TxClient, ctx, {
      action: "book.created",
      subjectType: "book",
      subjectId: "book-uuid-ccc",
      beforeJson: null,
      afterJson: { title: "Clean Code" },
    });

    // Exactly one INSERT call
    expect(mockTx.insert).toHaveBeenCalledTimes(1);
    expect(mockInsertChain.values).toHaveBeenCalledTimes(1);

    const inserted = capturedInsertValues[0] as Record<string, unknown>;

    // tenantId and actorId come from ctx
    expect(inserted.tenantId).toBe("tenant-uuid-aaa");
    expect(inserted.actorId).toBe("user-uuid-bbb");

    // Caller-supplied fields are forwarded
    expect(inserted.action).toBe("book.created");
    expect(inserted.subjectType).toBe("book");
    expect(inserted.subjectId).toBe("book-uuid-ccc");
    expect(inserted.afterJson).toEqual({ title: "Clean Code" });
    expect(inserted.beforeJson).toBeNull();
  });
});
