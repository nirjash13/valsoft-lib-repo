/**
 * withSystemTenantTx — per-tenant transaction helper for system-level (non-session) callers.
 *
 * SYSTEM-OWNER PATH — DO NOT IMPORT FROM TENANT-FACING CODE.
 *
 * This helper is the narrow escape hatch for background jobs (cron workers, workflows)
 * that have no Auth0 session but still need to run tenant-scoped domain functions under
 * full RLS protection.
 *
 * Invariants maintained (same as withTenantTx):
 *   Layer 3 — sets app.tenant_id and app.user_id via set_config(is_local=true), scoped
 *              to this transaction only. This is identical to what withTenantTx does.
 *   Layer 4 — RLS FORCE on every tenant table still fires; any query that hits a
 *              tenant-scoped table without app.tenant_id set raises insufficient_privilege.
 *
 * WHY a separate helper (not withTenantTx):
 *   withTenantTx reads ctx.tenantId / ctx.userId from the caller. The cron path has no
 *   session, so the caller supplies the tenantId directly (from the tenants table), and
 *   userId is set to the sentinel "system" to satisfy the NOT-NULL check in the GUC
 *   assertions and audit log schema. This is deliberate: audit rows written inside a
 *   system tx carry userId="system" so operators can distinguish them from user-driven
 *   mutations.
 *
 * IMPORT RESTRICTION: only lib/notifications/workflows/** and their direct callers
 * (app/api/cron/**) may import this module. Enforce via code-review policy and the
 * Biome custom rule `no-bare-db-call` (which excludes workflow + cron paths).
 */

import { sql } from "drizzle-orm";
import { db } from "./client";
import type { TenantCtx, TxClient } from "./with-tenant-tx";

/** Sentinel userId written into audit rows created by background system jobs. */
const SYSTEM_USER_ID = "system" as const;

/**
 * Opens a Postgres transaction for the given tenant, sets app.tenant_id and
 * app.user_id (to the "system" sentinel) as transaction-local GUC settings,
 * and calls `fn` with the tx client and a TenantCtx.
 *
 * Commit/rollback is handled automatically by Drizzle.
 *
 * @param tenantId - UUID of the tenant to operate on (must be non-empty).
 * @param fn       - Receives the transaction client and the resolved TenantCtx.
 */
export async function withSystemTenantTx<T>(
  tenantId: string,
  fn: (tx: TxClient, ctx: TenantCtx) => Promise<T>,
): Promise<T> {
  if (!tenantId) {
    throw new Error("withSystemTenantTx: tenantId must be a non-empty string.");
  }

  const ctx: TenantCtx = { tenantId, userId: SYSTEM_USER_ID };

  return db.transaction(async (tx) => {
    // Layer 3: transaction-local tenant binding — identical semantics to withTenantTx.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${SYSTEM_USER_ID}, true)`);
    return fn(tx as TxClient, ctx);
  });
}
