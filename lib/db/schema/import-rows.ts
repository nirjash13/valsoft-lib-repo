import { boolean, integer, jsonb, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, tenantIdColumn, updatedAt } from "./_shared";
import { books } from "./books";
import { importJobs } from "./import-jobs";

/**
 * import_rows — tracks the validation and processing state of each individual row in an import job.
 *
 * Multi-tenancy: tenant_id set from verified JWT org via withTenantTx.
 * RLS FORCE + assert_tenant() policy enforced.
 */
export const importRows = pgTable("import_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => importJobs.id, { onDelete: "cascade" }),
  rowIndex: integer("row_index").notNull(),

  status: varchar("status", { length: 20 }).notNull(), // 'pending', 'imported', 'failed', 'duplicate', 'skipped', 'merged'
  isbn13: varchar("isbn13", { length: 13 }),
  title: varchar("title", { length: 300 }),
  authors: text("authors").array(),
  year: integer("year"),
  publisher: varchar("publisher", { length: 200 }),
  pageCount: integer("page_count"),
  subjects: text("subjects").array(),
  language: varchar("language", { length: 10 }),
  description: varchar("description", { length: 4000 }),

  errorReason: text("error_reason"),
  existingBookId: uuid("existing_book_id").references(() => books.id, { onDelete: "set null" }),
  enrichmentSkipped: boolean("enrichment_skipped").notNull().default(false),
  rawData: jsonb("raw_data").$type<Record<string, string>>().notNull(),

  // Timestamps
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type ImportRowRow = typeof importRows.$inferSelect;
export type NewImportRowRow = typeof importRows.$inferInsert;
