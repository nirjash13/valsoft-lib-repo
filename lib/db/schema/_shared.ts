import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Branded ID helper — prevents accidentally passing a TenantId where a BookId is expected.
 * Usage: `type TenantId = Branded<string, "TenantId">`
 */
export type Branded<T, Brand extends string> = T & { readonly __brand: Brand };

export type TenantId = Branded<string, "TenantId">;
export type UserId = Branded<string, "UserId">;
export type BookId = Branded<string, "BookId">;

/**
 * Shared column: tenant_id (uuid, not null).
 * Every tenant-scoped table includes this column, and RLS policies enforce its value.
 */
export const tenantIdColumn = () => uuid("tenant_id").notNull();

/**
 * Standard created_at / updated_at columns (timestamptz(3), not null, defaultNow).
 *
 * precision: 3 → millisecond-precision storage. This ensures round-trips through
 * JS Date / ISO string serialization never lose precision (JS Date is ms-precision;
 * without this the raw Postgres microsecond value causes false-positive 409s in
 * the optimistic-concurrency check in update-book.ts — F-5 fix, critic Run A).
 */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow();
