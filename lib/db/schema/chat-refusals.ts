import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { type Branded, createdAt, tenantIdColumn } from "./_shared";

export type ChatRefusalId = Branded<string, "ChatRefusalId">;

/**
 * chat_refusal_reason — why the Reader's Advisor declined to answer.
 *
 * off_catalog: question was about books/topics outside this tenant's catalog.
 * policy:      question violated usage policy (e.g. prompt injection attempt).
 * error:       downstream error caused a safe refusal (model/gateway failure).
 */
export const chatRefusalReasonEnum = pgEnum("chat_refusal_reason", [
  "off_catalog",
  "policy",
  "error",
]);

/**
 * chat_refusals — audit trail of every Reader's Advisor refusal (REQ-06-08).
 *
 * Multi-tenancy: tenant_id set from verified JWT org via withTenantTx.
 * RLS FORCE + assert_tenant() policy enforced by migration 0009.
 *
 * thread_id and member_id are nullable:
 *   - A refusal that fires before a thread is created has no thread_id.
 *   - Anonymous/public-surface refusals (future) have no member_id.
 *
 * user_message: the raw text that triggered the refusal (for librarian review).
 */
export const chatRefusals = pgTable("chat_refusals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  threadId: uuid("thread_id"),
  memberId: uuid("member_id"),
  userMessage: text("user_message").notNull(),
  refusalReason: chatRefusalReasonEnum("refusal_reason").notNull(),
  createdAt: createdAt(),
});

export type ChatRefusalRow = typeof chatRefusals.$inferSelect;
export type NewChatRefusalRow = typeof chatRefusals.$inferInsert;
