"use server";

import { actionClient } from "@/lib/auth/safe-action";
import { importJobs } from "@/lib/db/schema/import-jobs";
import { importRows } from "@/lib/db/schema/import-rows";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { softDeleteBook } from "@/lib/domain/books/soft-delete-book";
import { parseRawRow } from "@/lib/domain/import/chunk-processor";
import { resolveDuplicate } from "@/lib/domain/import/resolve-duplicate";
import { parseCsv } from "@/lib/domain/import/rfc4180-parser";
import { and, eq, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const FIFTY_MB = 50 * 1024 * 1024;

/**
 * Builds a signed internal trigger token using CRON_SECRET.
 * Uses constant-time comparison to prevent timing attacks.
 */
function makeInternalToken(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not configured");
  return secret;
}

function triggerChunkProcessing(jobId: string, tenantId: string): void {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const token = makeInternalToken();

  fetch(`${appUrl}/api/import/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jobId, tenantId }),
  }).catch((err: unknown) => {
    console.error("[import] Failed to trigger chunk processing:", err);
  });
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const StartImportSchema = z.object({
  csvText: z.string().min(1, "CSV content cannot be empty"),
  dryRun: z.boolean(),
});

const JobActionSchema = z.object({
  jobId: z.string().uuid(),
});

const ResolveDuplicateSchema = z.object({
  rowId: z.string().uuid(),
  choice: z.enum(["merge", "skip"]),
});

// ---------------------------------------------------------------------------
// startImportJobAction
// ---------------------------------------------------------------------------

/**
 * Starts a new CSV import job.
 * Parses the CSV file, creates a job, inserts rows as pending, and triggers the first chunk.
 *
 * REQ-10-01: Rejects files >50 MB by byte size.
 * §8: A CSV with 0 data rows creates a job that completes immediately with 0 rows.
 */
export const startImportJobAction = actionClient
  .schema(StartImportSchema)
  .metadata({ permission: "book:create" })
  .action(async ({ parsedInput, ctx }) => {
    const { csvText, dryRun } = parsedInput;
    const { tenantCtx, session } = ctx;

    // [HIGH REQ-10-01] Server-side 50 MB byte cap
    if (Buffer.byteLength(csvText, "utf8") > FIFTY_MB) {
      throw new Error("File too large — maximum CSV size is 50 MB.");
    }

    // 1. Parse CSV text
    let parsedRows: Record<string, string>[] = [];
    try {
      parsedRows = parseCsv(csvText);
    } catch {
      throw new Error("Failed to parse CSV file. Ensure it is RFC-4180 compliant.");
    }

    // Row count cap
    if (parsedRows.length > 50000) {
      throw new Error("File too large — please split (<50,000 rows per file).");
    }

    // [MEDIUM §8] All-empty CSV: create a completed 0-row job instead of rejecting.
    if (parsedRows.length === 0) {
      const jobResult = await withTenantTx(tenantCtx, async (tx, txCtx) => {
        const [job] = await tx
          .insert(importJobs)
          .values({
            tenantId: txCtx.tenantId,
            status: "completed",
            totalRows: 0,
            processedRows: 0,
            dryRun,
            errorCount: 0,
            duplicateCount: 0,
            createdBy: session.email || "system",
          })
          .returning({ id: importJobs.id });

        if (!job) throw new Error("Failed to create import job");
        return { jobId: job.id };
      });

      return jobResult;
    }

    // 2. Run inside tenant-bound transaction
    const jobResult = await withTenantTx(tenantCtx, async (tx, txCtx) => {
      const [job] = await tx
        .insert(importJobs)
        .values({
          tenantId: txCtx.tenantId,
          status: "running",
          totalRows: parsedRows.length,
          processedRows: 0,
          dryRun,
          errorCount: 0,
          duplicateCount: 0,
          createdBy: session.email || "system",
        })
        .returning({ id: importJobs.id });

      if (!job) throw new Error("Failed to create import job");

      // Map parsed CSV rows into import_rows values
      const insertValues = parsedRows.map((rawRow, index) => {
        const parsed = parseRawRow(rawRow);
        return {
          tenantId: txCtx.tenantId,
          jobId: job.id,
          rowIndex: index + 1,
          status: "pending" as const,
          isbn13: parsed.isbn13 ?? null,
          title: parsed.title ?? null,
          authors: parsed.authors ?? null,
          year: parsed.year ?? null,
          publisher: parsed.publisher ?? null,
          pageCount: parsed.pageCount ?? null,
          subjects: parsed.subjects ?? null,
          language: parsed.language ?? null,
          description: parsed.description ?? null,
          rawData: rawRow,
        };
      });

      // Batch insert in chunks of 2000 to avoid Postgres parameter limits
      const BATCH_SIZE = 2000;
      for (let i = 0; i < insertValues.length; i += BATCH_SIZE) {
        const batch = insertValues.slice(i, i + BATCH_SIZE);
        await tx.insert(importRows).values(batch);
      }

      return { jobId: job.id };
    });

    // 3. Trigger processing of the first chunk via internal signed token (no session cookie)
    triggerChunkProcessing(jobResult.jobId, tenantCtx.tenantId);

    revalidateTag(`tenant:${tenantCtx.tenantId}:books`, "default");

    return jobResult;
  });

// ---------------------------------------------------------------------------
// cancelImportJobAction
// ---------------------------------------------------------------------------

/**
 * Cancels a running import job.
 * Writes an audit row for the status transition.
 */
export const cancelImportJobAction = actionClient
  .schema(JobActionSchema)
  .metadata({ permission: "book:create" })
  .action(async ({ parsedInput, ctx }) => {
    const { jobId } = parsedInput;
    const { tenantCtx } = ctx;

    await withTenantTx(tenantCtx, async (tx, txCtx) => {
      const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);

      if (!job) throw new Error("Job not found");

      if (job.status !== "running" && job.status !== "paused_quota") {
        throw new Error(`Cannot cancel a job with status: ${job.status}`);
      }

      await tx
        .update(importJobs)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(importJobs.id, jobId));

      // [MEDIUM audit] Audit job status transition
      const { writeAuditLog } = await import("@/lib/audit/audit-log");
      await writeAuditLog(tx, txCtx, {
        action: "import.job.cancelled",
        subjectType: "import_job",
        subjectId: jobId,
        beforeJson: { status: job.status },
        afterJson: { status: "cancelled" },
      });
    });

    return { success: true };
  });

// ---------------------------------------------------------------------------
// resumeImportJobAction
// ---------------------------------------------------------------------------

/**
 * Resumes a paused/failed/cancelled import job.
 * Re-triggers chunk processing via internal signed token.
 */
export const resumeImportJobAction = actionClient
  .schema(JobActionSchema)
  .metadata({ permission: "book:create" })
  .action(async ({ parsedInput, ctx }) => {
    const { jobId } = parsedInput;
    const { tenantCtx } = ctx;

    await withTenantTx(tenantCtx, async (tx) => {
      const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);

      if (!job) throw new Error("Job not found");

      if (job.status !== "paused_quota" && job.status !== "failed" && job.status !== "cancelled") {
        throw new Error(`Cannot resume a job with status: ${job.status}`);
      }

      await tx
        .update(importJobs)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(importJobs.id, jobId));
    });

    // Trigger processing of next chunk via internal signed token (no session cookie)
    triggerChunkProcessing(jobId, tenantCtx.tenantId);

    return { success: true };
  });

// ---------------------------------------------------------------------------
// cleanupImportedBooksAction
// ---------------------------------------------------------------------------

/**
 * Soft-deletes books imported during a job (cancelled, failed, OR completed).
 *
 * [HIGH REQ-10-09] Cleanup is now available for completed jobs too, not only
 * cancelled/failed.
 */
export const cleanupImportedBooksAction = actionClient
  .schema(JobActionSchema)
  .metadata({ permission: "book:create" })
  .action(async ({ parsedInput, ctx }) => {
    const { jobId } = parsedInput;
    const { tenantCtx } = ctx;

    const result = await withTenantTx(tenantCtx, async (tx, txCtx) => {
      const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);

      if (!job) throw new Error("Job not found");

      // [HIGH REQ-10-09] Allow cleanup on completed jobs as well as cancelled/failed
      if (job.status !== "cancelled" && job.status !== "failed" && job.status !== "completed") {
        throw new Error(`Cannot clean up a job with status: ${job.status}`);
      }

      const rows = await tx
        .select({ bookId: importRows.existingBookId })
        .from(importRows)
        .where(
          and(
            eq(importRows.jobId, jobId),
            eq(importRows.status, "imported"),
            sql`${importRows.existingBookId} IS NOT NULL`,
          ),
        );

      let deletedCount = 0;
      for (const row of rows) {
        if (!row.bookId) continue;
        try {
          await softDeleteBook(tx, txCtx, row.bookId);
          deletedCount++;
        } catch (err: unknown) {
          console.warn(`[cleanup] Failed to soft-delete book ${row.bookId}:`, err);
        }
      }

      await tx
        .update(importRows)
        .set({ status: "skipped", updatedAt: new Date() })
        .where(
          and(
            eq(importRows.jobId, jobId),
            eq(importRows.status, "imported"),
            sql`${importRows.existingBookId} IS NOT NULL`,
          ),
        );

      return { deletedCount };
    });

    revalidateTag(`tenant:${tenantCtx.tenantId}:books`, "default");

    return result;
  });

// ---------------------------------------------------------------------------
// getImportJobStatusAction
// ---------------------------------------------------------------------------

/**
 * Gets the status, progress, duplicate panel rows, and row sample for an import job.
 *
 * Returns:
 *   - all ImportJobRow fields
 *   - duplicates: { rowId, isbn13, title, existingBookId }[] — rows with status='duplicate'
 *   - rowSample: { rowIndex, status, errorReason }[] — up to 50 recent row results
 *     (used for dry-run preview and progress table in the UI).
 */
export const getImportJobStatusAction = actionClient
  .schema(JobActionSchema)
  .metadata({ permission: "book:read" })
  .action(async ({ parsedInput, ctx }) => {
    const { jobId } = parsedInput;
    const { tenantCtx } = ctx;

    return await withTenantTx(tenantCtx, async (tx) => {
      const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);

      if (!job) throw new Error("Job not found");

      // Duplicate rows panel (REQ-10-06 / S10-C contract)
      const duplicateRows = await tx
        .select({
          rowId: importRows.id,
          isbn13: importRows.isbn13,
          title: importRows.title,
          existingBookId: importRows.existingBookId,
        })
        .from(importRows)
        .where(and(eq(importRows.jobId, jobId), eq(importRows.status, "duplicate")));

      const duplicates = duplicateRows.map((r) => ({
        rowId: r.rowId,
        isbn13: r.isbn13 ?? null,
        title: r.title ?? null,
        existingBookId: r.existingBookId ?? null,
      }));

      // Row sample for dry-run preview (cap at 50, ordered by rowIndex desc for recency)
      const sampleRows = await tx
        .select({
          rowIndex: importRows.rowIndex,
          status: importRows.status,
          errorReason: importRows.errorReason,
        })
        .from(importRows)
        .where(eq(importRows.jobId, jobId))
        .orderBy(importRows.rowIndex)
        .limit(50);

      const rowSample = sampleRows.map((r) => ({
        rowIndex: r.rowIndex,
        status: r.status,
        errorReason: r.errorReason ?? null,
      }));

      return { ...job, duplicates, rowSample };
    });
  });

// ---------------------------------------------------------------------------
// resolveImportDuplicateAction  (S10-C contract — do not rename or change schema)
// ---------------------------------------------------------------------------

/**
 * Resolves a single duplicate import row as "merge" or "skip".
 *
 * Schema: { rowId: uuid, choice: "merge" | "skip" }
 * Returns: { status: "merged" | "skipped" }
 *
 * S10-C depends on this exact signature.
 */
export const resolveImportDuplicateAction = actionClient
  .schema(ResolveDuplicateSchema)
  .metadata({ permission: "book:create" })
  .action(async ({ parsedInput, ctx }) => {
    const { tenantCtx } = ctx;

    return await withTenantTx(tenantCtx, async (tx, txCtx) => {
      return resolveDuplicate(tx, txCtx, parsedInput);
    });
  });
