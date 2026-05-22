/**
 * POST /api/import/process — internal chunk-processing endpoint.
 *
 * Security: authorized by CRON_SECRET bearer token (same pattern as cron routes).
 * No session cookie — decoupled from the librarian session so long imports survive
 * session expiry (NFR-10-03 resumability).
 *
 * The action that starts an import and the cron sweeper both call this endpoint
 * with Authorization: Bearer <CRON_SECRET>. After processing a chunk, if the job
 * is still running this handler re-triggers itself for the next chunk (fast path).
 */

import { timingSafeEqual } from "node:crypto";
import { AiBudgetExceededError, AiBudgetNotConfiguredError } from "@/lib/ai/budget";
import { importJobs } from "@/lib/db/schema/import-jobs";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import { finalizeImportJob, processImportChunk } from "@/lib/domain/import/chunk-processor";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function triggerNextChunk(jobId: string, tenantId: string): void {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[import-process] CRON_SECRET not set — cannot chain next chunk");
    return;
  }
  fetch(`${appUrl}/api/import/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ jobId, tenantId }),
  }).catch((err: unknown) => {
    console.error(`[import-process] Error chaining next chunk for job ${jobId}:`, err);
  });
}

/**
 * Sends a paused_quota email notification to the librarian who started the job.
 * Mirrors the completion email path in finalizeImportJob.
 */
async function sendPausedQuotaEmail(jobId: string, tenantId: string): Promise<void> {
  try {
    const { withSystemTenantTx: systemTx } = await import("@/lib/db/with-system-tenant-tx");
    const { importJobs: jobsTable } = await import("@/lib/db/schema/import-jobs");
    const { tenants } = await import("@/lib/db/schema/tenants");
    const { sendEmail } = await import("@/lib/notifications/email-client");
    const { eq: drizzleEq } = await import("drizzle-orm");

    const { job, tenant } = await systemTx(tenantId, async (tx) => {
      const [j] = await tx.select().from(jobsTable).where(drizzleEq(jobsTable.id, jobId)).limit(1);
      const [t] = await tx.select().from(tenants).where(drizzleEq(tenants.id, tenantId));
      return { job: j, tenant: t };
    });

    if (!job) return;

    const libraryName = tenant?.name ?? "Stack Library";
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const importUrl = `${appUrl}/books/import`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background-color: #0b0f19; color: #f3f4f6; border-radius: 12px; border: 1px solid #1f2937;">
        <h2 style="color: #f59e0b; font-size: 24px; font-weight: 700; margin-top: 0; margin-bottom: 8px;">Import Paused — AI Quota Exceeded</h2>
        <p style="color: #9ca3af; font-size: 14px; margin-bottom: 24px;">Your CSV import job has been paused because continuing would exceed your library's monthly AI budget.</p>

        <div style="background-color: #111827; border-radius: 8px; padding: 20px; margin-bottom: 24px; border: 1px solid #374151;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #9ca3af; font-size: 14px;">Rows processed so far</td>
              <td style="padding: 6px 0; text-align: right; color: #f3f4f6; font-weight: 600; font-size: 14px;">${job.processedRows} of ${job.totalRows}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #9ca3af; font-size: 14px;">Errors</td>
              <td style="padding: 6px 0; text-align: right; color: #ef4444; font-weight: 600; font-size: 14px;">${job.errorCount}</td>
            </tr>
          </table>
        </div>

        <p style="color: #9ca3af; font-size: 14px; margin-bottom: 24px;">Already-processed rows are preserved. Once your AI budget resets or your administrator raises the cap, you can resume the import from the import history page.</p>

        <a href="${importUrl}" style="display: inline-block; background-color: #6366f1; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 600; font-size: 14px;">View Import Job</a>

        <div style="border-top: 1px solid #1f2937; padding-top: 20px; margin-top: 24px; font-size: 12px; color: #6b7280; text-align: center;">
          <p style="margin: 0;">Sent automatically by ${libraryName} Catalog Management.</p>
        </div>
      </div>
    `;

    await sendEmail({
      to: job.createdBy,
      subject: `Import Paused: AI quota would be exceeded — ${job.processedRows}/${job.totalRows} rows processed`,
      html: htmlContent,
    });
  } catch (err: unknown) {
    console.error("[import-process] Failed to send paused_quota email:", err);
  }
}

export async function POST(req: Request): Promise<Response> {
  // 1. Authorize via CRON_SECRET bearer token — no session cookie
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!cronSecret || !bearer || !constantTimeEq(bearer, cronSecret)) {
    return NextResponse.json(
      { type: "about:blank", title: "Unauthorized", status: 401, code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  // 2. Parse body
  let body: { jobId: string; tenantId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { jobId, tenantId: bodyTenantId } = body;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  // 3. Require tenantId in the body — all callers (startImportJobAction, resumeImportJobAction,
  //    triggerNextChunk, cron sweeper) must forward it. A bare-db fallback lookup is blocked
  //    by RLS FORCE on import_jobs, so it would return 0 rows and cause a silent 404.
  if (!bodyTenantId) {
    return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
  }
  const tenantId: string = bodyTenantId;

  try {
    const result = await withSystemTenantTx(tenantId, async (tx, ctx) => {
      return processImportChunk(tx, jobId, ctx);
    });

    if (result.pausedReason === "paused_quota") {
      // Budget-projection pause: chunk-processor caught AiBudgetExceededError internally,
      // set status='paused_quota', and returned instead of throwing.  We must NOT re-trigger
      // (that would loop), and we must send the paused-quota email here because the catch
      // block below is never reached on this path.
      sendPausedQuotaEmail(jobId, tenantId).catch((err2: unknown) => {
        console.error("[import-process] sendPausedQuotaEmail failed:", err2);
      });
    } else if (result.complete) {
      // Finalize: trickle embeddings and send completion email (fire-and-forget)
      finalizeImportJob(jobId, { tenantId, userId: "system" }, result.newBookIds).catch(
        (err: unknown) => {
          console.error(`[import-process] Error finalizing job ${jobId}:`, err);
        },
      );
    } else {
      // Fast-path: re-trigger next chunk — but only if the job is still running.
      // A job cancelled out-of-band returns { complete: false } from processImportChunk
      // (it early-returns when status !== 'running'); re-triggering it would loop.
      const [currentJob] = await withSystemTenantTx(tenantId, async (tx) =>
        tx
          .select({ status: importJobs.status })
          .from(importJobs)
          .where(eq(importJobs.id, jobId))
          .limit(1),
      );
      if (currentJob?.status === "running") {
        triggerNextChunk(jobId, tenantId);
      }
    }

    return NextResponse.json({ success: true, complete: result.complete });
  } catch (err: unknown) {
    // 4. Quota/budget pause
    if (err instanceof AiBudgetExceededError || err instanceof AiBudgetNotConfiguredError) {
      console.warn(`[import-process] Budget cap hit for job ${jobId}:`, (err as Error).message);

      try {
        await withSystemTenantTx(tenantId, async (tx) => {
          await tx
            .update(importJobs)
            .set({ status: "paused_quota", updatedAt: new Date() })
            .where(eq(importJobs.id, jobId));
        });
      } catch (updateErr: unknown) {
        console.error("[import-process] Failed to set job status to paused_quota:", updateErr);
      }

      // [HIGH REQ-10-07] Notify librarian of paused import
      sendPausedQuotaEmail(jobId, tenantId).catch((err2: unknown) => {
        console.error("[import-process] sendPausedQuotaEmail failed:", err2);
      });

      return NextResponse.json({
        success: false,
        status: "paused_quota",
        error: (err as Error).message,
      });
    }

    // 5. Fatal error — mark job as failed and write audit row
    console.error(`[import-process] Fatal error processing job ${jobId}:`, err);
    const msg = err instanceof Error ? err.message : String(err);

    try {
      await withSystemTenantTx(tenantId, async (tx, ctx) => {
        await tx
          .update(importJobs)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(importJobs.id, jobId));

        // [MEDIUM audit] Audit the failed job transition
        const { writeAuditLog } = await import("@/lib/audit/audit-log");
        await writeAuditLog(tx, ctx, {
          action: "import.job.failed",
          subjectType: "import_job",
          subjectId: jobId,
          afterJson: { status: "failed", reason: msg },
        });
      });
    } catch (updateErr: unknown) {
      console.error("[import-process] Failed to set job status to failed:", updateErr);
    }

    return NextResponse.json({ success: false, status: "failed", error: msg }, { status: 500 });
  }
}
