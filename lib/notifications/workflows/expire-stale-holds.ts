/**
 * expire-stale-holds — multi-tenant loop helpers for the hourly cron (REQ-03-06).
 *
 * Wired via Vercel Cron → app/api/cron/expire-holds/route.ts (Spec 03 Run C).
 *
 * SYSTEM-OWNER PATH — DO NOT IMPORT FROM TENANT-FACING CODE.
 * Only app/api/cron/expire-holds/route.ts should import the exported helpers below.
 */

import { db } from "@/lib/db/client";
import type { TenantId } from "@/lib/db/schema/_shared";
import { tenants } from "@/lib/db/schema/tenants";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import {
  type ExpireStaleHoldsResult,
  expireStaleHolds,
} from "@/lib/domain/holds/expire-stale-holds";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActiveTenant {
  id: TenantId;
  slug: string;
}

// ---------------------------------------------------------------------------
// listActiveTenants
// ---------------------------------------------------------------------------

/**
 * Returns all tenants that are eligible for background hold-expiry processing.
 *
 * Uses a direct db query (not withTenantTx) because the tenants table is NOT
 * tenant-scoped — it has no tenant_id column and no RLS policy referencing
 * app.tenant_id (see lib/db/schema/tenants.ts). The query enumerates all rows;
 * the per-tenant transactions below establish isolation.
 *
 * "Active" here means the tenant row exists and has not been soft-deleted (no
 * deletedAt on tenants as of this spec). All tenants receive hold-expiry processing.
 * A per-feature kill switch at the call site (isFeatureEnabled) gates the whole run.
 */
export async function listActiveTenants(): Promise<ReadonlyArray<ActiveTenant>> {
  const rows = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants);

  return rows.map((r) => ({
    id: r.id as TenantId,
    slug: r.slug,
  }));
}

// ---------------------------------------------------------------------------
// runExpireStaleHoldsForTenant
// ---------------------------------------------------------------------------

/**
 * Opens a per-tenant transaction, sets app.tenant_id (Layer 3), and runs
 * expireStaleHolds under full RLS protection (Layer 4).
 *
 * Returns the expiry/promotion counts reported by the domain function.
 * Throws on DB or domain errors — callers should catch per-tenant and continue.
 */
export async function runExpireStaleHoldsForTenant(
  tenantId: TenantId,
): Promise<ExpireStaleHoldsResult> {
  return withSystemTenantTx(tenantId, (tx, ctx) => expireStaleHolds(tx, ctx));
}
