/**
 * log-zero-result — records a zero-result search event (REQ-05-08).
 *
 * Inserts a row into search_zero_result_log within the caller's transaction
 * so the write is atomic with the search response path.
 *
 * The librarian dashboard (Spec 08) queries this table to surface "what are
 * members searching for that we don't have?"
 */

import { searchZeroResultLog } from "@/lib/db/schema/search-zero-result-log";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";

/**
 * Writes a zero-result search event row.
 *
 * @param tx    - Active tenant-scoped transaction.
 * @param ctx   - Tenant context (for tenant_id and user_id).
 * @param query - The search query string that returned 0 results.
 */
export async function logZeroResult(tx: TxClient, ctx: TenantCtx, query: string): Promise<void> {
  await tx.insert(searchZeroResultLog).values({
    tenantId: ctx.tenantId,
    query,
    userId: ctx.userId ?? null,
  });
}
