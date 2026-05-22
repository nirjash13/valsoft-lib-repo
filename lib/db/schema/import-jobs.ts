import { boolean, integer, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, tenantIdColumn, updatedAt } from "./_shared";
import { tenants } from "./tenants";

/**
 * import_jobs — tracks CSV upload status, totals, and owner.
 *
 * Multi-tenancy: tenant_id set from verified JWT org via withTenantTx.
 * RLS FORCE + assert_tenant() policy enforced.
 */
export const importJobs = pgTable("import_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn().references(() => tenants.id, { onDelete: "restrict" }),

  status: varchar("status", { length: 30 }).notNull(), // 'running', 'completed', 'failed', 'paused_quota', 'cancelled'
  totalRows: integer("total_rows").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  dryRun: boolean("dry_run").notNull().default(false),
  errorCount: integer("error_count").notNull().default(0),
  duplicateCount: integer("duplicate_count").notNull().default(0),
  createdBy: text("created_by").notNull(),

  // Timestamps
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type ImportJobRow = typeof importJobs.$inferSelect;
export type NewImportJobRow = typeof importJobs.$inferInsert;
