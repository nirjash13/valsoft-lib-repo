import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, tenantIdColumn } from "./_shared";
import { tenants } from "./tenants";

/**
 * members — library patrons (tenanted).
 *
 * A member may or may not be an Auth0 user. Staff-managed patrons (e.g., children's accounts)
 * have a null auth0UserId. Self-service sign-up is deferred to v2 per doc-04 open question 3.
 *
 * RLS: isolated by tenant_id.
 */
export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn().references(() => tenants.id, { onDelete: "cascade" }),
    auth0UserId: text("auth0_user_id"),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [unique("members_tenant_email_unique").on(table.tenantId, table.email)],
);

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
