import { integer, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { type Branded, createdAt, tenantIdColumn } from "./_shared";

export type AiUsageId = Branded<string, "AiUsageId">;

/**
 * ai_usage — per-request AI cost ledger (NFR-06-05, Spec 11 REQ-11-07).
 *
 * Multi-tenancy: tenant_id set from verified JWT org via withTenantTx.
 * RLS FORCE + assert_tenant() policy enforced by migration 0009.
 *
 * One row per LLM call. Summing cost_usd per (tenant_id, month) yields the
 * monthly spend used by budget.ts to enforce ai_monthly_cap_usd.
 *
 * thread_id: nullable — non-chat AI calls (e.g. ISBN enrichment) have no thread.
 *
 * feature: identifies the calling feature ("readers_advisor", "isbn_enrich", …)
 *   so the librarian dashboard can break down cost by feature.
 *
 * model: the gateway model string actually invoked (e.g.
 *   "anthropic/claude-sonnet-4-6") — may differ from the routing preference
 *   if a fallback was triggered.
 *
 * cost_usd: numeric(10,4) — up to $999,999.9999 per row; sufficient for any
 *   single request. Monthly aggregates may exceed this but are summed in the
 *   query layer, not stored here.
 */
export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  feature: text("feature").notNull(),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
  threadId: uuid("thread_id"),
  createdAt: createdAt(),
});

export type AiUsageRow = typeof aiUsage.$inferSelect;
export type NewAiUsageRow = typeof aiUsage.$inferInsert;
