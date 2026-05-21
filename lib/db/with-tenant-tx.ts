import { sql } from "drizzle-orm";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { db } from "./client";
import type * as schema from "./schema/index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantCtx {
  tenantId: string;
  userId: string;
  // ability and role are added in Run B once Auth0 JWT wiring is in place.
}

/**
 * The Drizzle transaction client type for the Neon serverless WebSocket driver.
 * Domain functions receive this instead of the full db client so they cannot
 * open a second transaction or escape the tenant-scoped connection.
 */
export type TxClient = Parameters<Parameters<NeonDatabase<typeof schema>["transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Thrown when withTenantTx is called with an empty or missing tenantId.
 * This is a programming error, not a user error — it should never reach production.
 */
export class MissingTenantContextError extends Error {
  override readonly name = "MissingTenantContextError";

  constructor(field: "tenantId" | "userId") {
    super(`withTenantTx: ctx.${field} must be a non-empty string.`);
  }
}

// ---------------------------------------------------------------------------
// withTenantTx
// ---------------------------------------------------------------------------

/**
 * Opens a Postgres transaction, binds the tenant + user IDs as session-local
 * settings, then calls `fn` with the transaction client and the validated context.
 *
 * WHY set_config (not SET LOCAL): Postgres rejects parameter placeholders inside
 * `SET LOCAL` syntax (`SET LOCAL app.tenant_id = $1` is a parser error). The
 * function form `set_config(name, value, is_local)` accepts parameters and is
 * the standard pattern for binding GUC values from application code. Passing
 * `is_local = true` makes the change scoped to the current transaction — the
 * exact semantics of `SET LOCAL`, which is what PgBouncer transaction-pool mode
 * requires to avoid leaking the tenant_id across pooled connections.
 *
 * The matching Postgres RLS policies call `assert_tenant()` (a STABLE plpgsql
 * function that RAISEs if `app.tenant_id` is NULL or empty), so any query that
 * bypasses withTenantTx fails with `insufficient_privilege` (REQ-01-10).
 * Custom GUC parameters (`app.*`) do NOT raise on unset from `current_setting()`
 * directly — they return an empty string — so the assertion function is required.
 *
 * @param ctx - Must contain non-empty tenantId and userId.
 * @param fn  - Receives the transaction client and the validated ctx.
 *              Commit/rollback is handled automatically by Drizzle.
 */
export async function withTenantTx<T>(
  ctx: TenantCtx,
  fn: (tx: TxClient, ctx: TenantCtx) => Promise<T>,
): Promise<T> {
  if (!ctx.tenantId) throw new MissingTenantContextError("tenantId");
  if (!ctx.userId) throw new MissingTenantContextError("userId");

  return db.transaction(async (tx) => {
    // Layer 3: request-scoped tenant + user binding (REQ-01-03 c).
    // These must be the first statements in the transaction. We use set_config()
    // instead of SET LOCAL because PG rejects $1 placeholders in SET LOCAL syntax.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.userId}, true)`);

    return fn(tx as TxClient, ctx);
  });
}
