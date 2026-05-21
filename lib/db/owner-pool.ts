/**
 * Shared owner-connection pool singleton.
 *
 * Uses DATABASE_URL_UNPOOLED (neondb_owner, BYPASSRLS) — the same connection
 * used for migrations and DDL. Two callers need this pool:
 *   1. lib/auth/resolve-tenant.ts — org_id → UUID lookup before app.tenant_id is bound
 *   2. lib/db/with-system-owner-tx.ts — provisioning (BYPASSRLS escape hatch)
 *
 * WHY a singleton: creating a fresh Pool per call and immediately calling pool.end()
 * inside finally {} is a known footgun on @neondatabase/serverless — pool.end() can
 * race with a connection being released back to the pool and throw "Cannot use a pool
 * after calling end on the pool". A module-level singleton avoids the race; the pool
 * closes naturally on process exit.
 *
 * SECURITY: This pool connects as neondb_owner (BYPASSRLS). It MUST only be used by
 * callers that have already verified the operation is privileged (system_owner CASL
 * check or pre-auth tenant resolution). Do NOT export this pool from a barrel.
 */

import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

let _ownerPool: Pool | null = null;

/**
 * Returns the shared owner-connection pool, lazily initialising it on first call.
 *
 * @throws If DATABASE_URL_UNPOOLED is not set (programming error in CI/prod config).
 */
export function getOwnerPool(): Pool {
  if (_ownerPool) return _ownerPool;

  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error(
      "DATABASE_URL_UNPOOLED is required for owner-connection operations. " +
        "Set it in .env.local (see .env.local.example).",
    );
  }

  // max:1 is sufficient for low-frequency privileged operations (provisioning, resolver).
  _ownerPool = new Pool({ connectionString: url, max: 1 });
  return _ownerPool;
}

/**
 * Replaces the owner pool singleton — for testing only.
 * @internal
 */
export function _setOwnerPoolForTest(pool: Pool | null): void {
  _ownerPool = pool;
}
