/**
 * search_zero_result_log — records queries that returned 0 results.
 *
 * Used by the librarian "0 results" report (REQ-05-08, Spec 08).
 * Written by lib/domain/search/log-zero-result.ts whenever a search
 * returns an empty result set.
 *
 * Multi-tenancy: RLS FORCE + assert_tenant() policy enforced by migration 0008.
 */

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantIdColumn } from "./_shared";

export const searchZeroResultLog = pgTable("search_zero_result_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),

  // The raw query string (up to 500 chars per SearchInputSchema)
  query: text("query").notNull(),

  // Auth0 sub of the user who searched (null for public catalog visitors)
  userId: text("user_id"),

  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

export type SearchZeroResultLogRow = typeof searchZeroResultLog.$inferSelect;
export type NewSearchZeroResultLogRow = typeof searchZeroResultLog.$inferInsert;
