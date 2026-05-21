import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Branded ID helper — prevents accidentally passing a TenantId where a BookId is expected.
 * Usage: `type TenantId = Branded<string, "TenantId">`
 */
export type Branded<T, Brand extends string> = T & { readonly __brand: Brand };

export type TenantId = Branded<string, "TenantId">;
export type UserId = Branded<string, "UserId">;

/**
 * Shared column: tenant_id (uuid, not null).
 * Every tenant-scoped table includes this column, and RLS policies enforce its value.
 */
export const tenantIdColumn = () => uuid("tenant_id").notNull();

/**
 * Standard created_at / updated_at columns (timestamptz, not null, defaultNow).
 */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
