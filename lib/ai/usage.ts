/**
 * recordAiUsage — shared AI usage ledger helper (REQ-11-07).
 *
 * Writes one `ai_usage` row inside the caller's existing transaction using a
 * SQL SAVEPOINT so a failed insert does NOT abort the outer transaction.
 *
 * REQ-11-07 contract: failure to write MUST NOT roll back the user-visible
 * action. The SAVEPOINT pattern achieves this without opening a second
 * connection: on insert failure we ROLLBACK TO SAVEPOINT (clearing Postgres'
 * aborted-tx state) then log at ALERT priority and return normally.
 *
 * NOTE: `lib/domain/chat/record-usage.ts` is a separate parallel writer used
 * only by the chat flow (it computes cost from token pricing constants and does
 * not accept a spanId). This helper is the canonical writer for all non-chat AI
 * calls (search embed, ISBN enrich, etc.) and accepts a caller-computed costUsd
 * plus an optional spanId for Langfuse cross-referencing. The two writers are
 * intentionally distinct — the chat flow owns its own cost-compute path.
 *
 * threadId must be a valid UUID (matches the uuid column type). Pass undefined
 * (omit the field) for non-chat calls rather than passing a non-UUID string, to
 * avoid a 22P02 type error that would poison the transaction.
 */

import type { TenantId } from "@/lib/db/schema/_shared";
import { aiUsage } from "@/lib/db/schema/ai-usage";
import type { TxClient } from "@/lib/db/with-tenant-tx";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// RecordAiUsageInput
// ---------------------------------------------------------------------------

/** UUID v4 regex — used to guard the threadId field before insert. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordAiUsageInput {
  tenantId: TenantId;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** Langfuse span ID for cross-referencing traces (REQ-11-02, REQ-11-07). */
  spanId?: string;
  /**
   * Thread ID for chat-originated calls. Must be a valid UUID — the column is
   * typed `uuid` and a non-UUID value raises 22P02, which would abort the tx.
   * Omit (pass undefined) for non-chat calls.
   */
  threadId?: string;
}

// ---------------------------------------------------------------------------
// recordAiUsage
// ---------------------------------------------------------------------------

const SAVEPOINT = "ai_usage_sp";

/**
 * Inserts one `ai_usage` row inside the caller's transaction, protected by a
 * SQL SAVEPOINT so a failed insert does NOT leave the outer tx in an aborted
 * state (REQ-11-07).
 *
 * On insert failure: ROLLBACK TO SAVEPOINT clears the Postgres abort flag,
 * then logs `[ai-usage][ALERT]` and returns without throwing.
 */
export async function recordAiUsage(tx: TxClient, input: RecordAiUsageInput): Promise<void> {
  // Validate threadId before reaching the DB to prevent a 22P02 error that
  // would fire before the SAVEPOINT catch can help (the error occurs in the
  // VALUES clause of the INSERT, which is inside the savepoint — but an invalid
  // UUID is caught here cheaply to produce a clearer log message).
  const threadId =
    input.threadId !== undefined && UUID_RE.test(input.threadId) ? input.threadId : undefined;

  try {
    await tx.execute(sql`SAVEPOINT ${sql.raw(SAVEPOINT)}`);
    try {
      await tx.insert(aiUsage).values({
        tenantId: input.tenantId,
        feature: input.feature,
        model: input.model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        costUsd: input.costUsd.toFixed(4),
        ...(input.spanId !== undefined ? { spanId: input.spanId } : {}),
        ...(threadId !== undefined ? { threadId } : {}),
      });
      await tx.execute(sql`RELEASE SAVEPOINT ${sql.raw(SAVEPOINT)}`);
    } catch (insertErr) {
      // Roll back to the savepoint so the outer tx is NOT aborted (REQ-11-07).
      try {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT ${sql.raw(SAVEPOINT)}`);
      } catch {
        // If the ROLLBACK itself fails the outer tx is already doomed — log and
        // let the outer tx commit/rollback naturally.
      }
      // Re-throw to the outer catch for ALERT logging.
      throw insertErr;
    }
  } catch (err) {
    // REQ-11-07: write failure must not roll back user-visible action.
    console.error(
      "[ai-usage][ALERT] Failed to write ai_usage row — cost tracking may be incomplete.",
      {
        tenantId: input.tenantId,
        feature: input.feature,
        model: input.model,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    // swallow — intentional per REQ-11-07
  }
}
