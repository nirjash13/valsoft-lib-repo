/**
 * AI budget guard — must be called before every LLM invocation.
 *
 * In Run A (Spec 02): reads the tenant's `ai_monthly_cap_usd` from the tenants
 * table and throws if the cap is null/zero (meaning the tenant has not been
 * configured for AI use). Full per-request usage tracking and monthly accumulation
 * are deferred to Spec 11.
 *
 * TODO (Spec 11 REQ-11-03): after asserting the cap is configured, check the
 * accumulated usage for the current billing period against ai_monthly_cap_usd
 * and throw AiBudgetExceededError if usage + estimatedCostUsd would exceed the cap.
 *
 * The cap is read via the owner pool (no tenant binding needed — the tenants
 * table itself uses a membership-based RLS policy, not app.tenant_id, so reading
 * via owner bypasses RLS safely. The owner connection is BYPASSRLS by design).
 */

import { getOwnerPool } from "@/lib/db/owner-pool";
import type { TenantId } from "@/lib/db/schema/_shared";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AiBudgetExceededError extends Error {
  override readonly name = "AiBudgetExceededError";
  constructor(tenantId: string, capUsd: number, estimatedUsd: number) {
    super(`AI budget exceeded for tenant ${tenantId}: cap=$${capUsd}, estimated=$${estimatedUsd}`);
  }
}

export class AiBudgetNotConfiguredError extends Error {
  override readonly name = "AiBudgetNotConfiguredError";
  constructor(tenantId: string) {
    super(`AI monthly cap is not configured for tenant ${tenantId}. Set ai_monthly_cap_usd > 0.`);
  }
}

// ---------------------------------------------------------------------------
// assertAiBudget
// ---------------------------------------------------------------------------

/**
 * Verifies the tenant has a non-zero AI budget configured.
 *
 * @param tenantId      - The resolved tenant UUID.
 * @param estimatedCostUsd - Estimated cost of the upcoming LLM call (for logging;
 *                           full enforcement is Spec 11).
 *
 * @throws AiBudgetNotConfiguredError if ai_monthly_cap_usd is null or 0.
 * @throws AiBudgetExceededError if estimated cost exceeds the cap (Spec 11 stub:
 *         in Run A this only fires if estimatedCostUsd > capUsd with no accumulated check).
 */
export async function assertAiBudget(tenantId: TenantId, estimatedCostUsd: number): Promise<void> {
  const pool = getOwnerPool();
  const client = await pool.connect();
  try {
    const result = await client.query<{ ai_monthly_cap_usd: string | null }>(
      "SELECT ai_monthly_cap_usd FROM tenants WHERE id = $1 LIMIT 1",
      [tenantId],
    );

    if (result.rows.length === 0) {
      // Tenant row not found — treat as not configured
      throw new AiBudgetNotConfiguredError(tenantId);
    }

    const rawCap = result.rows[0]?.ai_monthly_cap_usd;
    const capUsd = rawCap != null ? Number.parseFloat(rawCap) : 0;

    if (!Number.isFinite(capUsd) || capUsd <= 0) {
      throw new AiBudgetNotConfiguredError(tenantId);
    }

    // Sum usage from ai_usage table for the current billing month (UTC month)
    const usageResult = await client.query<{ mtd_cost: string | null }>(
      "SELECT SUM(cost_usd) as mtd_cost FROM ai_usage WHERE tenant_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)",
      [tenantId],
    );
    const mtdCost =
      usageResult.rows[0]?.mtd_cost != null ? Number.parseFloat(usageResult.rows[0].mtd_cost) : 0;

    if (mtdCost + estimatedCostUsd > capUsd) {
      throw new AiBudgetExceededError(tenantId, capUsd, mtdCost + estimatedCostUsd);
    }
  } finally {
    client.release();
  }
}
