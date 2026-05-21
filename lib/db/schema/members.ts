import { pgEnum, pgTable, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, tenantIdColumn, updatedAt } from "./_shared";
import { tenants } from "./tenants";

/**
 * members_status — patron account state.
 *
 * - pending:   signed up but not yet approved (Spec 04 self-signup flow).
 * - active:    approved; can borrow and place holds.
 * - suspended: blocked from circulation actions by an admin.
 *
 * NOTE: This is the minimal stub for Spec 03. Spec 04 extends with:
 *   - auth0_user_id linkage for self-service login
 *   - approval queue + librarian approval workflow
 *   - role linkage to CASL (member role permissions)
 *   - late-fee flag hook (can_borrow=false)
 */
export const memberStatusEnum = pgEnum("member_status", ["pending", "active", "suspended"]);

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn().references(() => tenants.id, { onDelete: "cascade" }),
    status: memberStatusEnum("status").notNull().default("active"),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // UNIQUE (tenant_id, lower(email)) — enforced by the DB UNIQUE INDEX in the migration.
    // Drizzle does not support functional unique constraints natively; the index is
    // hand-written in the migration SQL. This table-level unique is a fallback for
    // case-sensitive dedup only; the migration index handles case-insensitive.
    unique("members_tenant_email_unique").on(table.tenantId, table.email),
  ],
);

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
