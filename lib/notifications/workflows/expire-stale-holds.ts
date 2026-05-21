/**
 * expireStaleHoldsWorkflow — hourly worker stub (REQ-03-06).
 *
 * This stub exports the trigger-ready function. The Vercel Workflow DevKit
 * scheduled trigger is wired in Spec 03 Run C.
 *
 * TODO (Spec 03 Run C): wire @vercel/workflow scheduled trigger:
 *   import { defineWorkflow } from "@vercel/workflow";
 *   export const expireStaleHoldsWorkflow = defineWorkflow({
 *     name: "expire-stale-holds",
 *     schedule: { cron: "0 * * * *" },   // every hour
 *     async run({ step }) {
 *       await step.do("expire-and-promote", () =>
 *         withTenantTx(systemCtx, (tx, ctx) => expireStaleHoldsForAllTenants(tx, ctx)),
 *       );
 *     },
 *   });
 *
 * The domain function `expireStaleHolds` is complete and tested. The workflow
 * must re-establish `app.tenant_id` via `withTenantTx` for each tenant — it
 * cannot inherit the tenant context from a triggering request.
 */

import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { expireStaleHolds } from "@/lib/domain/holds/expire-stale-holds";

/**
 * Runs the stale-hold expiry logic for a single tenant transaction.
 * Call this from the Vercel Workflow step once per tenant.
 *
 * @param tx  - Active tenant transaction from withTenantTx.
 * @param ctx - Tenant context.
 */
export async function runExpireStaleHolds(
  tx: TxClient,
  ctx: TenantCtx,
): Promise<{ expiredCount: number; promotedCount: number }> {
  return expireStaleHolds(tx, ctx);
}
