import type { TxClient } from "@/lib/db/with-tenant-tx";
import { sql } from "drizzle-orm";
import { METRIC_DIMENSION_WHITELIST, type ReportQuery } from "./schema";

const VIEW_MAPPING = {
  loans_count: {
    subject: "reporting.loans_by_subject",
    year: "reporting.loans_by_year",
    member_role: "reporting.loans_by_member_role",
    total: "reporting.loans_total",
  },
  unique_borrowers: {
    subject: "reporting.loans_by_subject",
    year: "reporting.loans_by_year",
    member_role: "reporting.loans_by_member_role",
    total: "reporting.loans_total",
  },
  holds_placed: {
    subject: "reporting.holds_by_subject",
    year: "reporting.holds_by_year",
    member_role: "reporting.holds_by_member_role",
    total: "reporting.holds_total",
  },
  searches_zero_result: {
    year: "reporting.searches_zero_result_by_year",
    member_role: "reporting.searches_zero_result_by_member_role",
    total: "reporting.searches_zero_result_total",
  },
  ai_cost_usd: {
    feature: "reporting.ai_cost_by_feature",
    model: "reporting.ai_cost_by_model",
    year: "reporting.ai_cost_by_year",
    member_role: "reporting.ai_cost_by_member_role",
    total: "reporting.ai_cost_total",
  },
} as const;

export interface ReportQueryResult {
  rows: Record<string, unknown>[];
  sql: string;
}

/**
 * Compiles and executes a ReportQuery against the reporting view schema.
 * Rejects any non-whitelisted metrics/dimensions.
 * Sets app.current_period in session local settings.
 */
export async function executeReportQuery(
  tx: TxClient,
  query: ReportQuery,
): Promise<ReportQueryResult> {
  const metric = query.metric;
  const dimension = query.dimension;

  // 1. Double check whitelist
  if (dimension) {
    const allowed = METRIC_DIMENSION_WHITELIST[metric] as readonly string[];
    if (!allowed.includes(dimension)) {
      throw new Error(`Metric '${metric}' cannot be grouped by '${dimension}'`);
    }
  } else {
    // If searches_zero_result is queried without dimension, total is valid.
    // However, if a dimension is requested, it must be year or member_role.
  }

  // Retrieve view name
  const viewMap = VIEW_MAPPING[metric] as Record<string, string>;
  const viewName = dimension ? viewMap[dimension] : viewMap.total;
  if (!viewName) {
    throw new Error(`No view found for metric '${metric}' and dimension '${dimension || "total"}'`);
  }

  // 2. Set current period local parameter
  await tx.execute(sql`SELECT set_config('app.current_period', ${query.period}, true)`);

  // 3. Compile SQL (safe because viewName and dimension are strictly whitelisted strings)
  let querySql = sql`SELECT * FROM ${sql.raw(viewName)}`;
  let virtualSql = `SELECT * FROM ${viewName}`;

  if (dimension && query.filter && query.filter[dimension]) {
    const filterVal = query.filter[dimension];
    querySql = sql`SELECT * FROM ${sql.raw(viewName)} WHERE ${sql.raw(dimension)} = ${filterVal}`;
    virtualSql += ` WHERE ${dimension} = ?`;
  }

  const result = await tx.execute(querySql);

  return {
    rows: (result.rows as Record<string, unknown>[]) || [],
    sql: virtualSql,
  };
}

// ---------------------------------------------------------------------------
// Pre-built Dashboard panel fetches
// ---------------------------------------------------------------------------

export async function getOverviewDashboard(tx: TxClient) {
  const [kpiRes, topCirculatedRes, circulationRes] = await Promise.all([
    tx.execute(sql`SELECT * FROM reporting.overview_kpis`),
    tx.execute(sql`SELECT * FROM reporting.top_circulated_this_week`),
    tx.execute(sql`SELECT * FROM reporting.circulation_by_day`),
  ]);

  return {
    kpis: kpiRes.rows[0] as
      | {
          active_loans: number;
          overdue_loans: number;
          holds_queued: number;
          signups_today: number;
        }
      | undefined,
    topCirculated: topCirculatedRes.rows as {
      book_id: string;
      title: string;
      authors: string[];
      checkout_count: number;
    }[],
    circulationHistory: circulationRes.rows as {
      date: string;
      checkout_count: number;
      return_count: number;
      hold_count: number;
    }[],
  };
}

export async function getCirculationDashboard(tx: TxClient) {
  const [circulationRes, topBorrowersRes, topBooksRes, loanDurationRes] = await Promise.all([
    tx.execute(sql`SELECT * FROM reporting.circulation_by_day`),
    tx.execute(sql`SELECT * FROM reporting.top_borrowers`),
    tx.execute(sql`SELECT * FROM reporting.top_books_detailed`),
    tx.execute(sql`SELECT * FROM reporting.loan_duration_stats`),
  ]);

  return {
    circulationHistory: circulationRes.rows as {
      date: string;
      checkout_count: number;
      return_count: number;
      hold_count: number;
    }[],
    topBorrowers: topBorrowersRes.rows as {
      member_id: string;
      display_name: string;
      email: string;
      loan_count: number;
      overdue_count: number;
    }[],
    topBooks: topBooksRes.rows as {
      book_id: string;
      title: string;
      isbn: string;
      checkout_count: number;
      hold_count: number;
      avg_loan_duration_days: number;
    }[],
    loanDurationStats: loanDurationRes.rows[0] as
      | {
          avg_loan_duration_days: number;
          max_loan_duration_days: number;
        }
      | undefined,
  };
}

export async function getDiscoveryDashboard(tx: TxClient) {
  const res = await tx.execute(sql`SELECT * FROM reporting.zero_result_searches`);
  return {
    zeroResultSearches: res.rows as {
      query: string;
      search_count: number;
      last_searched_at: string;
    }[],
  };
}

export async function getMembersDashboard(tx: TxClient) {
  const [statusRes, signupsRes, churnRes] = await Promise.all([
    tx.execute(sql`SELECT * FROM reporting.member_status_stats`),
    tx.execute(sql`SELECT * FROM reporting.member_signups_by_week`),
    tx.execute(sql`SELECT * FROM reporting.member_churn_proxy`),
  ]);

  return {
    statusStats: statusRes.rows as {
      status: string;
      count: number;
    }[],
    signupsHistory: signupsRes.rows as {
      week_start: string;
      signup_count: number;
    }[],
    churnProxy: churnRes.rows as {
      member_id: string;
      display_name: string;
      email: string;
      created_at: string;
      last_activity_at: string | null;
    }[],
  };
}

export async function getAiUsageDashboard(tx: TxClient, tenantId: string) {
  const [quotaRes, refusalsRes, featureCostRes, modelCostRes, roleCostRes, tenantCapRes] =
    await Promise.all([
      tx.execute(sql`SELECT * FROM reporting.ai_latency_and_quota`),
      tx.execute(sql`SELECT * FROM reporting.chat_refusals_24h`),
      tx.execute(sql`SELECT * FROM reporting.ai_cost_by_feature`),
      tx.execute(sql`SELECT * FROM reporting.ai_cost_by_model`),
      tx.execute(sql`SELECT * FROM reporting.ai_cost_by_member_role`),
      tx.execute(sql`SELECT ai_monthly_cap_usd FROM public.tenants WHERE id = ${tenantId}::uuid`),
    ]);

  const kpis = quotaRes.rows[0] as
    | {
        p95_latency_ms: number | null;
        total_spend_usd: string | null;
      }
    | undefined;

  const cap = tenantCapRes.rows[0] as { ai_monthly_cap_usd: string } | undefined;

  return {
    p95LatencyMs: kpis?.p95_latency_ms ?? null,
    totalSpendUsd: Number.parseFloat(kpis?.total_spend_usd ?? "0"),
    monthlyCapUsd: Number.parseFloat(cap?.ai_monthly_cap_usd ?? "50.00"),
    refusals: refusalsRes.rows as {
      refusal_reason: string;
      refusal_count: number;
      sample_messages: string | null;
    }[],
    costByFeature: featureCostRes.rows as {
      feature: string;
      ai_cost_usd: string;
    }[],
    costByModel: modelCostRes.rows as {
      model: string;
      ai_cost_usd: string;
    }[],
    costByRole: roleCostRes.rows as {
      member_role: string;
      ai_cost_usd: string;
    }[],
  };
}

export interface AuditLogFilters {
  actorId?: string;
  action?: string;
  subjectType?: string;
  startDate?: string;
  endDate?: string;
}

export async function getAuditDashboard(
  tx: TxClient,
  filters: AuditLogFilters,
  limit = 25,
  cursor?: string,
) {
  // Construct parameterized dynamic filters
  const conditions = [];

  if (filters.actorId) {
    conditions.push(sql`actor_id = ${filters.actorId}::uuid`);
  }
  if (filters.action) {
    conditions.push(sql`action = ${filters.action}`);
  }
  if (filters.subjectType) {
    conditions.push(sql`subject_type = ${filters.subjectType}`);
  }
  if (filters.startDate) {
    conditions.push(sql`occurred_at >= ${filters.startDate}::timestamptz`);
  }
  if (filters.endDate) {
    conditions.push(sql`occurred_at <= ${filters.endDate}::timestamptz`);
  }

  // Handle cursor pagination: order by occurred_at DESC, id DESC
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
      if (decoded.occurredAt && decoded.id) {
        conditions.push(
          sql`(occurred_at, id) < (${decoded.occurredAt}::timestamptz, ${decoded.id}::uuid)`,
        );
      }
    } catch {
      // Ignore malformed cursor
    }
  }

  const whereClause =
    conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

  // We ask for limit + 1 rows to see if there's a next page
  const querySql = sql`
    SELECT * FROM reporting.audit_logs_timeline
    ${whereClause}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${limit + 1}
  `;

  const res = await tx.execute(querySql);
  const rows = res.rows as {
    id: string;
    actor_id: string | null;
    action: string;
    subject_type: string;
    subject_id: string | null;
    before_json: unknown;
    after_json: unknown;
    occurred_at: string;
  }[];

  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;

  let nextCursor: string | undefined = undefined;
  if (hasNextPage && pageRows.length > 0) {
    const lastRow = pageRows[pageRows.length - 1];
    if (lastRow) {
      nextCursor = Buffer.from(
        JSON.stringify({ occurredAt: lastRow.occurred_at, id: lastRow.id }),
        "utf8",
      ).toString("base64");
    }
  }

  return {
    logs: pageRows,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Platform Dashboard (System Owner Only)
// ---------------------------------------------------------------------------

export async function getPlatformDashboard(tx: TxClient) {
  // Query base tables directly bypass tenant constraints (since this runs with System Owner connection)
  const [tenantsRes, mauRes, aiCostRes] = await Promise.all([
    tx.execute(sql`SELECT COUNT(*)::int AS count FROM public.tenants`),
    tx.execute(sql`
      SELECT COUNT(DISTINCT user_id)::int AS count FROM (
        SELECT actor_id::text AS user_id FROM public.audit_log WHERE occurred_at >= NOW() - INTERVAL '30 days' AND actor_id IS NOT NULL
        UNION
        SELECT member_id::text AS user_id FROM public.loans WHERE checked_out_at >= NOW() - INTERVAL '30 days'
      ) as active_users
    `),
    tx.execute(sql`
      SELECT COALESCE(SUM(cost_usd), 0)::numeric(10,4) AS count 
      FROM public.ai_usage 
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `),
  ]);

  const activeTenantsRow = tenantsRes.rows[0] as { count: number } | undefined;
  const totalMauRow = mauRes.rows[0] as { count: number } | undefined;
  const aiCostRow = aiCostRes.rows[0] as { count: string } | undefined;

  return {
    activeTenants: activeTenantsRow?.count ?? 0,
    totalMau: totalMauRow?.count ?? 0,
    platformAiCostUsd: Number.parseFloat(aiCostRow?.count ?? "0"),
  };
}
