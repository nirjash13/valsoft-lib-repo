/**
 * GET /api/cron/process-imports — Vercel Cron safety-net endpoint (NFR-10-03).
 *
 * Scheduled hourly via vercel.json: `{ "path": "/api/cron/process-imports", "schedule": "0 * * * *" }`.
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically.
 *
 * Purpose: finds import_jobs with status='running' whose updated_at is stale (>5 min)
 * and re-triggers their chunk processing. This handles the case where a fire-and-forget
 * fetch between chunks was lost (e.g., platform restart, transient network failure).
 *
 * Security model:
 *   - Bearer token check: rejects 401 if absent or token mismatches CRON_SECRET.
 *   - Each re-trigger POST to /api/import/process also requires CRON_SECRET bearer.
 *   - Per-job try/catch: one failing job logs + continues; does not abort the sweep.
 *
 * Returns:
 *   200 { count: number, retriggered: string[] }  — jobIds re-triggered
 *   401 — missing or invalid bearer token
 */

import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db/client";
import { importJobs } from "@/lib/db/schema/import-jobs";
import { problem } from "@/lib/http/problem";
import { and, eq, lt } from "drizzle-orm";

export const runtime = "nodejs";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(req: Request): Promise<Response> {
  // --- Auth: verify Vercel Cron secret ---
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!cronSecret || !bearer || !constantTimeEq(bearer, cronSecret)) {
    return problem(401, "Unauthorized", "Missing or invalid CRON_SECRET bearer token.");
  }

  // Find all stuck running jobs (updated_at older than STALE_THRESHOLD_MS)
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  // Note: no RLS needed here — we query with the owner connection to find stuck jobs
  // across all tenants. The subsequent /api/import/process call re-establishes
  // withSystemTenantTx (RLS Layer 3 + 4) for the actual processing.
  const staleJobs = await db
    .select({ id: importJobs.id, tenantId: importJobs.tenantId })
    .from(importJobs)
    .where(and(eq(importJobs.status, "running"), lt(importJobs.updatedAt, staleThreshold)));

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const retriggered: string[] = [];

  for (const job of staleJobs) {
    try {
      // Fire-and-forget re-trigger — the process endpoint handles idempotency
      // (it checks job.status === 'running' before doing any work).
      fetch(`${appUrl}/api/import/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({ jobId: job.id, tenantId: job.tenantId }),
      }).catch((err: unknown) => {
        console.error(`[process-imports cron] Failed to re-trigger job ${job.id}:`, err);
      });

      retriggered.push(job.id);
    } catch (err: unknown) {
      console.error(`[process-imports cron] Error processing stale job ${job.id}:`, err);
    }
  }

  return Response.json({ count: retriggered.length, retriggered });
}
