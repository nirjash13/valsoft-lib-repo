import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, tenantIdColumn, updatedAt } from "./_shared";
import { tenants } from "./tenants";

/**
 * books — the central catalog table for each tenant.
 *
 * Multi-tenancy: tenant_id is set from the verified JWT org → UUID (via withTenantTx).
 * RLS FORCE + assert_tenant() policy enforced by migration 0004.
 *
 * Soft-delete: deleted_at IS NOT NULL hides the row from all standard queries.
 * Purge (anonymize) after 30 days deferred to Spec 08 daily worker.
 *
 * pgvector embedding column deferred to Spec 05 (search/discovery).
 * tsvector full-text column deferred to Spec 05.
 */
export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn().references(() => tenants.id, { onDelete: "restrict" }),

  // --- ISBN ---
  isbn13: varchar("isbn13", { length: 13 }),

  // --- Core catalog fields (BookRecord schema) ---
  title: varchar("title", { length: 300 }).notNull(),
  authors: text("authors").array().notNull(),
  year: integer("year"),
  publisher: varchar("publisher", { length: 200 }),
  pageCount: integer("page_count"),
  subjects: text("subjects").array(),
  language: varchar("language", { length: 10 }),
  coverUrl: text("cover_url"),
  description: varchar("description", { length: 4000 }),
  customFields: jsonb("custom_fields").$type<Record<string, string>>(),

  // --- Timestamps ---
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type BookRow = typeof books.$inferSelect;
export type NewBookRow = typeof books.$inferInsert;
