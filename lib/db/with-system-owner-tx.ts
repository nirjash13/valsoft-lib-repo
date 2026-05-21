/**
 * withSystemOwnerTx — operator-mode transaction helper.
 *
 * Used exclusively by `system_owner` actions (e.g., tenant provisioning) that
 * must write across tenant boundaries. This helper:
 *   1. Uses the shared owner-connection pool (lib/db/owner-pool.ts) which wraps
 *      DATABASE_URL_UNPOOLED (neondb_owner, BYPASSRLS, DDL rights) — NOT the
 *      stack_app runtime connection.
 *   2. Sets `app.system_owner = 'true'` (is_local=true) so the tenants table RLS
 *      policy (migration 0003) allows the write via its operator-mode branch.
 *   3. Is intentionally NOT exported from the main db barrel — callers must import
 *      it explicitly so grep / code review can find system_owner escapes.
 *
 * Pool lifecycle: the pool is a module-level singleton (via lib/db/owner-pool.ts)
 * and is reused across calls. We do NOT call pool.end() per invocation — that would
 * race with in-flight connection releases on @neondatabase/serverless and throw
 * "Cannot use a pool after calling end on the pool". The pool closes naturally
 * on process exit.
 *
 * WHY owner connection (not stack_app):
 *   - stack_app's RLS on `tenants` (after migration 0003) would reject an INSERT
 *     from a context where app.user_id is not yet a member of the new tenant.
 *   - Tenant provisioning is an inherently privileged, low-frequency operation
 *     (operator, not end-user). Using the owner connection gives us DDL-level
 *     access without compromising the runtime path.
 *   - Spec 01 §7: "explicit 'operator mode' sets app.system_owner='true' and uses
 *     a separate RLS policy … Off by default; gated by a feature flag."
 *
 * SECURITY NOTE: This helper MUST only be called from actions gated by the
 * `tenant:provision` permission (system_owner role only). The CASL check in
 * actionClient ensures this before the action body runs.
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { getOwnerPool } from "./owner-pool";
import * as schema from "./schema/index";

export type SystemOwnerTxClient = Parameters<
  Parameters<NeonDatabase<typeof schema>["transaction"]>[0]
>[0];

/**
 * Opens a transaction using the owner connection (BYPASSRLS) and sets
 * `app.system_owner = 'true'` for the duration. Calls `fn` with the tx client.
 *
 * The pool is a shared singleton — NOT a fresh pool per call. Reuse avoids the
 * pool.end() race condition on @neondatabase/serverless.
 *
 * @throws If DATABASE_URL_UNPOOLED is not set (programming error in CI/prod config).
 */
export async function withSystemOwnerTx<T>(
  fn: (tx: SystemOwnerTxClient) => Promise<T>,
): Promise<T> {
  // Shared owner pool — lazy-init, reused across calls, no pool.end() per invocation.
  const ownerDb: NeonDatabase<typeof schema> = drizzle(getOwnerPool(), { schema });

  return ownerDb.transaction(async (tx) => {
    // Signal to the tenants RLS operator-mode policy that this is a system_owner op.
    await tx.execute(sql`SELECT set_config('app.system_owner', 'true', true)`);
    return fn(tx as SystemOwnerTxClient);
  });
}
