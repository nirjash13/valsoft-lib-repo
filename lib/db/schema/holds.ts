import { pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, tenantIdColumn, updatedAt } from "./_shared";
import { books } from "./books";
import { members } from "./members";
import { tenants } from "./tenants";

/**
 * hold_status — queue position lifecycle.
 *
 * queued:    waiting in line for the book.
 * ready:     book returned; member has hold_pickup_hours to claim it.
 * expired:   ready window passed; hold demoted; next in queue promoted.
 * cancelled: member or librarian cancelled the hold.
 */
export const holdStatusEnum = pgEnum("hold_status", ["queued", "ready", "expired", "cancelled"]);

/**
 * holds — waiting-list entries (REQ-03-04).
 *
 * Multi-tenancy: tenant_id is set from the verified JWT org → UUID (via withTenantTx).
 * RLS FORCE + assert_tenant() policy enforced by migration 0006.
 *
 * UNIQUENESS: A member may have at most one active (queued or ready) hold per book.
 * Enforced by a PARTIAL UNIQUE INDEX in the migration:
 *   CREATE UNIQUE INDEX holds_active_unique ON holds (tenant_id, book_id, member_id)
 *   WHERE status IN ('queued', 'ready');
 *
 * FIFO ordering: holds in status='queued' are promoted in ascending queued_at order.
 */
export const holds = pgTable("holds", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn().references(() => tenants.id, { onDelete: "restrict" }),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "restrict" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "restrict" }),

  queuedAt: timestamp("queued_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  status: holdStatusEnum("status").notNull().default("queued"),
  readyUntil: timestamp("ready_until", { withTimezone: true, precision: 3 }),

  // Standard timestamps
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type HoldRow = typeof holds.$inferSelect;
export type NewHoldRow = typeof holds.$inferInsert;
