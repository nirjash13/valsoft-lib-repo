import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * Five roles per Spec 04. Stored on the membership row for fast app-side checks.
 * Auth0 Role is the authoritative source; this mirrors it.
 */
export const MEMBER_ROLES = [
  "system_owner",
  "tenant_admin",
  "librarian",
  "member",
  "guest",
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBERSHIP_STATUSES = ["active", "pending", "rejected", "suspended"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * tenant_memberships — per-tenant role for each Auth0 user.
 * RLS: isolated by tenant_id (only visible within the same tenant context).
 */
export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull().$type<MemberRole>(),
    status: text("status").notNull().default("active").$type<MembershipStatus>(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    check(
      "tenant_memberships_role_check",
      sql`${table.role} IN ('system_owner', 'tenant_admin', 'librarian', 'member', 'guest')`,
    ),
    check(
      "tenant_memberships_status_check",
      sql`${table.status} IN ('active', 'pending', 'rejected', 'suspended')`,
    ),
  ],
);

export type TenantMembership = typeof tenantMemberships.$inferSelect;
export type NewTenantMembership = typeof tenantMemberships.$inferInsert;
