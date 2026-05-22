/**
 * GET /api/cron/send-reminders — Vercel Cron endpoint (REQ-07-01).
 *
 * Scheduled hourly via vercel.json: `{ "crons": [{ "path": "/api/cron/send-reminders", "schedule": "0 * * * *" }] }`.
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when a cron is configured.
 *
 * Security model:
 *   - Bearer token check: rejects 401 if header is absent or token mismatches CRON_SECRET.
 *   - Kill switch: isFeatureEnabled("send_reminders") — returns 200 { skipped: true } if off.
 *   - Per-tenant isolation: runRemindersForTenant uses withSystemTenantTx (SET LOCAL app.tenant_id),
 *     so RLS FORCE on every tenant-scoped table still fires (Layer 4 invariant).
 *   - Per-tenant try/catch: one failing tenant logs + continues; does not abort the batch.
 *
 * Returns:
 *   200 { count: number, results: Array<{ tenantId, sent, skipped } | { tenantId, error }> }
 *   200 { skipped: true }  — feature flag off
 *   401 — missing or invalid bearer token
 */

import { timingSafeEqual } from "node:crypto";
import type { TenantId } from "@/lib/db/schema/_shared";
import { isFeatureEnabled } from "@/lib/flags";
import { problem } from "@/lib/http/problem";
import { runRemindersForTenant } from "@/lib/notifications/reminders";
import { listActiveTenants } from "@/lib/notifications/workflows/expire-stale-holds";

/**
 * Constant-time string comparison to prevent timing attacks on the bearer token.
 * Returns false immediately (without Buffer allocation) when lengths differ.
 */
function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const runtime = "nodejs"; // Needs pg WebSocket driver — not Edge-compatible.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TenantSuccess = {
  tenantId: TenantId;
  sent: number;
  skipped: number;
};

type TenantFailure = {
  tenantId: TenantId;
  error: string;
};

type TenantResult = TenantSuccess | TenantFailure;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  // --- Auth: verify Vercel Cron secret ---
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!cronSecret || !bearer || !constantTimeEq(bearer, cronSecret)) {
    return problem(401, "Unauthorized", "Missing or invalid CRON_SECRET bearer token.");
  }

  // --- Kill switch ---
  if (!(await isFeatureEnabled("send_reminders"))) {
    return Response.json({ skipped: true });
  }

  // --- Multi-tenant loop ---
  const activeTenants = await listActiveTenants();
  const results: TenantResult[] = [];

  for (const tenant of activeTenants) {
    try {
      const { sent, skipped } = await runRemindersForTenant(tenant.id);
      results.push({ tenantId: tenant.id, sent, skipped });
    } catch (err) {
      // Log and continue — one tenant failure must not abort the whole batch.
      // M5 fix: keep full detail in the log but return only a generic message
      // in the JSON response (raw error strings may contain PII; REQ-07-10).
      console.error(`[send-reminders] tenant=${tenant.id} slug=${tenant.slug} error:`, err);
      results.push({ tenantId: tenant.id, error: "reminder run failed" });
    }
  }

  return Response.json({ count: results.length, results });
}
