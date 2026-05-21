import { bigserial, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantIdColumn } from "./_shared";
import { tenants } from "./tenants";

/**
 * audit_log — append-only record of every authoritative mutation (REQ-01-06).
 *
 * Invariants enforced at the DB layer (see migration 0000_init.sql):
 *   - REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC — no row may be mutated after insert.
 *   - RLS FORCE — tenant_id isolation same as every other tenanted table.
 *
 * The audit writer (lib/audit/) is implemented in Run B. This file defines the schema only.
 */
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  tenantId: tenantIdColumn().references(() => tenants.id, { onDelete: "restrict" }),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id"),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
