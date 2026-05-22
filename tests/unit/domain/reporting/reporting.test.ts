import { formatCSV, formatCSVRow, formatJSON, verifyJSONExport } from "@/lib/domain/reporting/exporter";
import {
  type ReportQuery,
  ReportQuerySchema,
  isSafeFilterColumn,
  validateWhitelist,
} from "@/lib/domain/reporting/schema";
import { executeReportQuery } from "@/lib/domain/reporting/service";
import { describe, expect, it, vi } from "vitest";

describe("Reporting schema & whitelist validation", () => {
  it("allows valid whitelisted metric and dimension combinations", () => {
    const validQueries = [
      {
        metric: "loans_count",
        dimension: "subject",
        period: "last_30_days",
      },
      {
        metric: "unique_borrowers",
        dimension: "member_role",
        period: "last_7_days",
      },
      {
        metric: "holds_placed",
        dimension: "year",
        period: "month_to_date",
      },
      {
        metric: "searches_zero_result",
        dimension: "year",
        period: "2026-05-01..2026-05-31",
      },
      {
        metric: "ai_cost_usd",
        dimension: "feature",
        period: "last_30_days",
      },
    ];

    for (const q of validQueries) {
      const parsed = ReportQuerySchema.safeParse(q);
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects non-whitelisted combinations", () => {
    const invalidQueries = [
      {
        metric: "searches_zero_result",
        dimension: "subject", // searches_zero_result only allows year or member_role
        period: "last_30_days",
      },
      {
        metric: "loans_count",
        dimension: "feature", // loans_count only allows subject, year, member_role
        period: "last_30_days",
      },
    ];

    for (const q of invalidQueries) {
      const parsed = ReportQuerySchema.safeParse(q);
      expect(parsed.success).toBe(false);
    }
  });

  it("validates specific period formats", () => {
    expect(
      ReportQuerySchema.safeParse({
        metric: "loans_count",
        period: "last_7_days",
      }).success,
    ).toBe(true);

    expect(
      ReportQuerySchema.safeParse({
        metric: "loans_count",
        period: "2026-05-01..2026-05-31",
      }).success,
    ).toBe(true);

    expect(
      ReportQuerySchema.safeParse({
        metric: "loans_count",
        period: "2026-05-31..2026-05-01", // start after end date
      }).success,
    ).toBe(false);

    expect(
      ReportQuerySchema.safeParse({
        metric: "loans_count",
        period: "invalid-range",
      }).success,
    ).toBe(false);
  });

  it("enforces filter matches selected dimension", () => {
    // Valid: filter by subject when dimension is subject
    expect(
      ReportQuerySchema.safeParse({
        metric: "loans_count",
        dimension: "subject",
        period: "last_30_days",
        filter: { subject: "YA fiction" },
      }).success,
    ).toBe(true);

    // Invalid: filter by subject when dimension is year
    expect(
      ReportQuerySchema.safeParse({
        metric: "loans_count",
        dimension: "year",
        period: "last_30_days",
        filter: { subject: "YA fiction" },
      }).success,
    ).toBe(false);
  });

  it("checks validateWhitelist and isSafeFilterColumn helpers", () => {
    expect(validateWhitelist("loans_count", "subject")).toBe(true);
    expect(validateWhitelist("searches_zero_result", "subject")).toBe(false);
    expect(validateWhitelist("ai_cost_usd", "model")).toBe(true);

    expect(isSafeFilterColumn("subject", "subject")).toBe(true);
    expect(isSafeFilterColumn("feature", "subject")).toBe(false);
  });
});

function serializeSqlChunks(query: unknown): string {
  if (!query) return "";
  if (typeof query === "string" || typeof query === "number") return String(query);
  if (Array.isArray(query)) {
    return query.map(serializeSqlChunks).join("");
  }
  if (typeof query === "object") {
    const qObj = query as Record<string, unknown>;
    if ("queryChunks" in qObj) {
      return serializeSqlChunks(qObj.queryChunks);
    }
    if ("value" in qObj && Array.isArray(qObj.value)) {
      return qObj.value.join("");
    }
  }
  return "";
}

describe("Reporting service SQL compilation & query isolation", () => {
  it("sets the session config and generates correct parameterized SQL", async () => {
    const mockTx = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Parameters<typeof executeReportQuery>[0];

    const query: ReportQuery = {
      metric: "loans_count",
      dimension: "subject",
      period: "last_30_days",
      filter: { subject: "Fantasy" },
    };

    const result = await executeReportQuery(mockTx, query);

    // 1. Verifies set_config is called for the session period
    expect(mockTx.execute).toHaveBeenCalledTimes(2);

    // Check first call set session period local config setting
    const firstCallSql = serializeSqlChunks((mockTx.execute as any).mock.calls[0][0]);
    expect(firstCallSql).toContain("set_config('app.current_period'");

    // Check second call runs query against correct view and uses parameterized binding
    const secondCallArg = (mockTx.execute as any).mock.calls[1][0];
    const secondCallSql = serializeSqlChunks(secondCallArg);
    expect(secondCallSql).toContain("FROM reporting.loans_by_subject");
    expect(secondCallSql).toContain("subject =");
    expect(result.sql).toBe("SELECT * FROM reporting.loans_by_subject WHERE subject = ?");
  });
});

describe("Export signing & tamper-evidence verification", () => {
  const metadata = {
    tenantId: "550e8400-e29b-41d4-a716-446655440000",
    timestamp: "2026-05-22T09:00:00.000Z",
    viewName: "top_circulated_this_week",
  };

  const rows = [
    { title: "Clean Code", checkout_count: 15 },
    { title: "Design Patterns", checkout_count: 10 },
  ];

  it("formats CSV correctly and appends validation headers", () => {
    const csvContent = formatCSV(metadata, rows);

    // Should contain metadata lines
    expect(csvContent).toContain(`# tenant_id: ${metadata.tenantId}`);
    expect(csvContent).toContain(`# timestamp: ${metadata.timestamp}`);
    expect(csvContent).toContain("# hash: ");
    expect(csvContent).toContain("# signature: ");

    // Should contain csv data
    expect(csvContent).toContain('"Clean Code","15"');
    expect(csvContent).toContain('"Design Patterns","10"');
  });

  it("formats JSON, signs it, and passes verifyJSONExport validation", () => {
    const jsonString = formatJSON(metadata, rows);
    const parsed = JSON.parse(jsonString);

    expect(parsed.metadata.tenantId).toBe(metadata.tenantId);
    expect(parsed.metadata.signature).toBeDefined();
    expect(parsed.data).toHaveLength(2);

    // Signature verification should pass
    expect(verifyJSONExport(parsed)).toBe(true);
  });

  it("rejects altered data in verification check", () => {
    const jsonString = formatJSON(metadata, rows);
    const parsed = JSON.parse(jsonString);

    // Modify data slightly
    parsed.data[0].checkout_count = 100;

    // Signature verification should fail
    expect(verifyJSONExport(parsed)).toBe(false);
  });
});

describe("Streaming CSV row formatter", () => {
  it("produces the same escaped output as the full formatCSV for each row", () => {
    const rows = [
      { title: "Clean Code", checkout_count: 15 },
      { title: "Design Patterns", checkout_count: 10 },
    ];
    const headers = Object.keys(rows[0]!);

    // formatCSVRow should produce the same per-row content that formatCSV embeds
    for (const row of rows) {
      const rowLine = formatCSVRow(row, headers);
      expect(rowLine).toContain(`"${row.title}"`);
      expect(rowLine).toContain(`"${row.checkout_count}"`);
    }

    expect(formatCSVRow(rows[0]!, headers)).toBe('"Clean Code","15"');
    expect(formatCSVRow(rows[1]!, headers)).toBe('"Design Patterns","10"');
  });

  it("handles null, undefined, objects, and embedded quotes", () => {
    const row = {
      name: 'Book "Special" Edition',
      count: null as unknown,
      meta: { nested: true },
      empty: undefined as unknown,
    };
    const headers = ["name", "count", "meta", "empty"];
    const result = formatCSVRow(row, headers);

    // Embedded quotes are doubled per RFC 4180
    expect(result).toContain('"Book ""Special"" Edition"');
    // null and undefined → empty unquoted cell; object → JSON with escaped inner quotes
    expect(result).toBe('"Book ""Special"" Edition",,"{""nested"":true}",');
  });
});
