import { jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, tenantIdColumn } from "./_shared";
import { tenants } from "./tenants";

/**
 * isbn_cache — per-tenant cache of Open Library + Google Books merged metadata.
 *
 * TTL is enforced at the application layer (putCached sets expires_at;
 * getCached rejects rows past that timestamp). No scheduled purge is needed
 * for correctness — stale rows are invisible to the app and harmless.
 *
 * RLS FORCE + assert_tenant() policy enforced by migration 0004 — ensures
 * a tenant cannot read another tenant's cached data (useful because a tenant
 * may have applied custom_fields overrides to a cached entry).
 *
 * NFR-02-02: identical preview within a tenant for the same ISBN within 24 h.
 */
export const isbnCache = pgTable("isbn_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn().references(() => tenants.id, { onDelete: "cascade" }),
  isbn13: varchar("isbn13", { length: 13 }).notNull(),
  payload: jsonb("payload").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export type IsbnCacheRow = typeof isbnCache.$inferSelect;
export type NewIsbnCacheRow = typeof isbnCache.$inferInsert;
