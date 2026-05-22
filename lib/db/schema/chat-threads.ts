import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { type Branded, createdAt, tenantIdColumn, updatedAt } from "./_shared";

export type ChatThreadId = Branded<string, "ChatThreadId">;

/**
 * chat_threads — one thread per (member, page_context, session).
 *
 * Multi-tenancy: tenant_id set from verified JWT org via withTenantTx.
 * RLS FORCE + assert_tenant() policy enforced by migration 0009.
 *
 * page_context: opaque key identifying where chat was opened
 *   e.g. "global", "books", "book:<uuid>".
 *
 * Partial UNIQUE INDEX on (tenant_id, member_id, page_context) WHERE archived_at IS NULL
 * ensures at most one active thread per member per context.
 *
 * archived_at: set by the archival worker (thread archival cron — deferred, Spec 06 §9).
 * last_message_at: updated by append-message domain fn; used for ordering/archival.
 */
export const chatThreads = pgTable("chat_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  memberId: uuid("member_id").notNull(),
  pageContext: text("page_context").notNull(),
  title: text("title"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true, precision: 3 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type ChatThreadRow = typeof chatThreads.$inferSelect;
export type NewChatThreadRow = typeof chatThreads.$inferInsert;
