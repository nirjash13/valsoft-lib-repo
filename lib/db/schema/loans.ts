import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, tenantIdColumn, updatedAt } from "./_shared";
import { books } from "./books";
import { members } from "./members";
import { tenants } from "./tenants";

/**
 * loans — one row per borrow transaction (REQ-03-01).
 *
 * Multi-tenancy: tenant_id is set from the verified JWT org → UUID (via withTenantTx).
 * RLS FORCE + assert_tenant() policy enforced by migration 0006.
 *
 * Lifecycle:
 *   active:   returned_at IS NULL
 *   returned: returned_at IS NOT NULL
 *   overdue:  returned_at IS NULL AND due_at < NOW()
 *
 * librarian_id is the Auth0 `sub` of the librarian who performed the action.
 * It is stored as text (not FK) because librarians are Auth0 users, not members rows.
 *
 * Soft-delete (deleted_at): included for consistency with other tenanted tables but
 * never set by normal circulation flow. Reserved for future purge worker (Spec 08).
 */
export const loans = pgTable("loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn().references(() => tenants.id, { onDelete: "restrict" }),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "restrict" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "restrict" }),

  // Actor who performed the borrow (JWT sub — text, not FK to members)
  librarianId: text("librarian_id").notNull(),

  // Timestamps
  checkedOutAt: timestamp("checked_out_at", { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true, precision: 3 }).notNull(),
  returnedAt: timestamp("returned_at", { withTimezone: true, precision: 3 }),

  // Renewal tracking
  renewedCount: integer("renewed_count").notNull().default(0),

  // Standard timestamps
  createdAt: createdAt(),
  updatedAt: updatedAt(),

  // Soft-delete (normally NULL; reserved for Spec 08 purge worker)
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type LoanRow = typeof loans.$inferSelect;
export type NewLoanRow = typeof loans.$inferInsert;
