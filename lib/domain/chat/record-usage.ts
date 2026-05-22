/**
 * recordUsage — inserts an ai_usage row for cost ledger (NFR-06-05, Spec 11 REQ-11-07).
 *
 * Cost is computed from token counts using per-1M-token pricing constants documented here.
 * Accuracy is not critical (a rough row existing is what matters for Spec 11 budget checks).
 *
 * Pricing constants (claude-sonnet-4-6 as of 2026-05, per Anthropic pricing page):
 *   Input:  $3.00 / 1M tokens
 *   Output: $15.00 / 1M tokens
 *
 * If real token counts are unavailable (inputTokens/outputTokens undefined), falls back to 0.
 */

import { aiUsage } from "@/lib/db/schema/ai-usage";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";

/** Input cost per 1M tokens in USD (claude-sonnet-4-6). */
const INPUT_COST_PER_1M = 3.0;
/** Output cost per 1M tokens in USD (claude-sonnet-4-6). */
const OUTPUT_COST_PER_1M = 15.0;

interface RecordUsageInput {
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Pre-computed cost in USD; if omitted, computed from token counts above. */
  costUsd?: number;
  threadId?: string;
}

export async function recordUsage(
  tx: TxClient,
  ctx: TenantCtx,
  input: RecordUsageInput,
): Promise<void> {
  const { feature, model, promptTokens, completionTokens, threadId } = input;

  const costUsd =
    input.costUsd ??
    (promptTokens * INPUT_COST_PER_1M + completionTokens * OUTPUT_COST_PER_1M) / 1_000_000;

  await tx.insert(aiUsage).values({
    tenantId: ctx.tenantId,
    feature,
    model,
    promptTokens,
    completionTokens,
    costUsd: costUsd.toFixed(4),
    ...(threadId !== undefined ? { threadId } : {}),
  });
}
