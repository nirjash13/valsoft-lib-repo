import { boolean, integer, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared";

/**
 * tenants — one row per library (tenant).
 *
 * This table is NOT tenant-scoped (it has no tenant_id column and no RLS policy
 * referencing app.tenant_id). Access to this table is controlled via tenant_memberships:
 * a user may only read the tenant they belong to. The system_owner role policy is added
 * in Run B when the full CASL + membership guard is in place.
 */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  auth0OrgId: text("auth0_org_id").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  brandVoice: text("brand_voice"),
  aiMonthlyCapUsd: numeric("ai_monthly_cap_usd", { precision: 10, scale: 2 }).default("50.00"),
  loanDurationDays: integer("loan_duration_days").notNull().default(14),
  holdPickupHours: integer("hold_pickup_hours").notNull().default(72),
  maxRenewals: integer("max_renewals").notNull().default(2),
  publicCatalogEnabled: boolean("public_catalog_enabled").notNull().default(false),
  createdAt: createdAt(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
