import { AiBudgetExceededError, AiBudgetNotConfiguredError, assertAiBudget } from "@/lib/ai/budget";
import { writeAuditLog } from "@/lib/audit/audit-log";
import type { BookId, TenantId } from "@/lib/db/schema/_shared";
import { books } from "@/lib/db/schema/books";
import { importJobs } from "@/lib/db/schema/import-jobs";
import type { ImportJobRow } from "@/lib/db/schema/import-jobs";
import { importRows } from "@/lib/db/schema/import-rows";
import { tenants } from "@/lib/db/schema/tenants";
import type { Tenant } from "@/lib/db/schema/tenants";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { IsbnInvalidError } from "@/lib/domain/books/errors";
import { normalizeIsbn } from "@/lib/domain/books/isbn";
import { previewIsbn } from "@/lib/domain/books/preview-isbn";
import { BookRecordSchema } from "@/lib/domain/books/schemas";
import { embedBook } from "@/lib/domain/search/embed-book";
import { sendEmail } from "@/lib/notifications/email-client";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-row cost constant for AI enrichment budget projection (NFR-10-05).
 * Conservative upper bound without cache: $0.005/row.
 */
const ENRICHMENT_COST_PER_ROW_USD = 0.005;

/**
 * Maximum number of retry attempts for transient (5xx-class) enrichment failures.
 * REQ-10-10: 3-strikes rule.
 */
const ENRICHMENT_MAX_RETRIES = 3;

/**
 * Maximum characters allowed in the description field (varchar(4000)).
 * §8 edge case: truncate with a non-fatal notice instead of failing the row.
 */
const DESCRIPTION_MAX_CHARS = 4000;

/**
 * Parses semicolon-separated fields.
 */
export function parseArrayField(val: string | null | undefined): string[] | undefined {
  if (val === null || val === undefined || val.trim() === "") return undefined;
  return val
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parses raw CSV row values into the appropriate schema types.
 */
export function parseRawRow(rawData: Record<string, string>) {
  const isbn13 = rawData.isbn13?.trim() || undefined;
  const title = rawData.title?.trim() || undefined;
  const authors = parseArrayField(rawData.authors);

  const rawYear = rawData.year?.trim();
  const year = rawYear ? Number.parseInt(rawYear, 10) : undefined;

  const publisher = rawData.publisher?.trim() || undefined;

  const rawPageCount = rawData.page_count?.trim() || rawData.pagecount?.trim();
  const pageCount = rawPageCount ? Number.parseInt(rawPageCount, 10) : undefined;

  const subjects = parseArrayField(rawData.subjects);
  const language = rawData.language?.trim() || undefined;
  const description = rawData.description?.trim() || undefined;

  return {
    isbn13,
    title,
    authors,
    year,
    publisher,
    pageCount,
    subjects,
    language,
    description,
  };
}

interface ProcessChunkResult {
  complete: boolean;
  newBookIds: string[];
  /** Truthy string key when the job was paused; the route should act on it. */
  pausedReason?: "paused_quota";
}

/**
 * Returns true if a value is genuinely present (non-empty).
 *
 * REQ-10-02 fix: numeric 0, NaN, empty string, and null/undefined are all treated
 * as absent so enriched data is not overwritten by meaningless CSV defaults.
 */
function isPresent<T>(val: T | null | undefined): boolean {
  if (val === null || val === undefined) return false;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === "string") return val.trim() !== "";
  if (typeof val === "number") return Number.isFinite(val) && val !== 0;
  return true;
}

/**
 * Merges a CSV-supplied value with an enriched value.
 * CSV wins only when genuinely present (see `isPresent`).
 *
 * REQ-10-02: treats numeric 0 / NaN as absent so enriched data is preserved.
 */
const mergeField = <T>(
  csvVal: T | null | undefined,
  enrichedVal: T | null | undefined,
): T | null | undefined => {
  return isPresent(csvVal) ? csvVal : enrichedVal;
};

/**
 * Determines whether an enrichment error is transient (retry-able).
 * 4xx / validation / ISBN errors are permanent — do not retry.
 * 5xx / network / timeout errors are transient — retry up to ENRICHMENT_MAX_RETRIES.
 */
function isTransientEnrichmentError(err: unknown): boolean {
  if (err instanceof IsbnInvalidError) return false;
  if (err instanceof AiBudgetExceededError) return false;
  if (err instanceof AiBudgetNotConfiguredError) return false;
  if (err instanceof Error) {
    // Treat HTTP-status-carrying errors with 4xx as permanent
    const msg = err.message.toLowerCase();
    if (
      msg.includes("400") ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("404") ||
      msg.includes("422")
    ) {
      return false;
    }
    return true;
  }
  return true;
}

/**
 * Processes a single chunk of up to 25 pending rows for the given import job.
 * Runs inside the caller's transaction context.
 */
export async function processImportChunk(
  tx: TxClient,
  jobId: string,
  tenantCtx: TenantCtx,
): Promise<ProcessChunkResult> {
  const { tenantId } = tenantCtx;

  // 1. Fetch current job status
  const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);

  if (!job) {
    throw new Error(`Import job ${jobId} not found`);
  }

  if (job.status !== "running") {
    // If the job was cancelled or paused, we don't process anything in this transaction.
    return { complete: false, newBookIds: [] };
  }

  // 2. Fetch the next 25 pending rows ordered by rowIndex
  const rows = await tx
    .select()
    .from(importRows)
    .where(and(eq(importRows.jobId, jobId), eq(importRows.status, "pending")))
    .orderBy(importRows.rowIndex)
    .limit(25);

  if (rows.length === 0) {
    // No more pending rows
    return { complete: true, newBookIds: [] };
  }

  // REQ-10-07: project enrichment cost for this chunk before processing any row.
  // Count rows that have an ISBN (would trigger enrichment) and are not cache hits.
  // We use a conservative per-row constant (NFR-10-05: $0.005 without cache).
  const isbnRowCount = rows.filter((r) => r.isbn13).length;
  if (isbnRowCount > 0) {
    const projectedCost = isbnRowCount * ENRICHMENT_COST_PER_ROW_USD;
    try {
      await assertAiBudget(tenantId as TenantId, projectedCost);
    } catch (err) {
      if (err instanceof AiBudgetExceededError || err instanceof AiBudgetNotConfiguredError) {
        // Pause the job cleanly at this chunk checkpoint; do not process any rows.
        await tx
          .update(importJobs)
          .set({ status: "paused_quota", updatedAt: new Date() })
          .where(eq(importJobs.id, jobId));
        return { complete: false, newBookIds: [], pausedReason: "paused_quota" };
      }
      throw err;
    }
  }

  let processedInChunk = 0;
  let errorsInChunk = 0;
  let duplicatesInChunk = 0;
  const newBookIds: string[] = [];

  for (const row of rows) {
    try {
      let cleanIsbn: string | null = null;
      let isDuplicate = false;
      let duplicateBookId: string | null = null;
      // exactOptionalPropertyTypes: all fields are nullable/undefinable so we can
      // assign them freely without omit tricks.
      let finalRecord: {
        isbn13?: string | null;
        title?: string | null;
        authors?: string[] | null;
        year?: number | null;
        publisher?: string | null;
        pageCount?: number | null;
        subjects?: string[] | null;
        language?: string | null;
        description?: string | null;
      } = {};
      let skipEnrichment = false;
      /** Non-fatal notice for the row (e.g. description truncated). */
      let rowNotice: string | undefined;

      // Validate/Normalize ISBN if present
      if (row.isbn13) {
        try {
          cleanIsbn = normalizeIsbn(row.isbn13);
        } catch (err) {
          if (err instanceof IsbnInvalidError) {
            await tx
              .update(importRows)
              .set({
                status: "failed",
                errorReason: err.message,
                updatedAt: new Date(),
              })
              .where(eq(importRows.id, row.id));
            errorsInChunk++;
            processedInChunk++;
            continue;
          }
          throw err;
        }

        // Check for duplicate in books catalog (tenant-scoped via RLS)
        const existingBooks = await tx
          .select({ id: books.id })
          .from(books)
          .where(and(eq(books.isbn13, cleanIsbn), sql`${books.deletedAt} IS NULL`))
          .limit(1);

        if (existingBooks.length > 0) {
          isDuplicate = true;
          // biome-ignore lint/style/noNonNullAssertion: safe — existingBooks.length > 0 asserts row exists
          duplicateBookId = existingBooks[0]!.id;
        } else {
          // Check for duplicate within the same import job
          const earlierDuplicate = await tx
            .select({ existingBookId: importRows.existingBookId })
            .from(importRows)
            .where(
              and(
                eq(importRows.jobId, jobId),
                eq(importRows.isbn13, cleanIsbn),
                inArray(importRows.status, ["imported", "duplicate"]),
                lt(importRows.rowIndex, row.rowIndex),
              ),
            )
            .limit(1);

          const firstDup = earlierDuplicate[0];
          if (firstDup?.existingBookId) {
            isDuplicate = true;
            duplicateBookId = firstDup.existingBookId;
          }
        }

        if (isDuplicate) {
          await tx
            .update(importRows)
            .set({
              status: "duplicate",
              isbn13: cleanIsbn,
              existingBookId: duplicateBookId,
              updatedAt: new Date(),
            })
            .where(eq(importRows.id, row.id));
          duplicatesInChunk++;
          processedInChunk++;
          continue;
        }

        // REQ-10-10: 3-strikes enrichment retry for transient 5xx failures.
        let preview: Awaited<ReturnType<typeof previewIsbn>> | null = null;
        let enrichmentError: unknown = null;
        for (let attempt = 1; attempt <= ENRICHMENT_MAX_RETRIES; attempt++) {
          try {
            preview = await previewIsbn(tx, tenantId as TenantId, cleanIsbn);
            enrichmentError = null;
            break;
          } catch (err) {
            if (!isTransientEnrichmentError(err)) {
              // Permanent error (4xx, budget, invalid ISBN): re-throw immediately.
              throw err;
            }
            enrichmentError = err;
            if (attempt < ENRICHMENT_MAX_RETRIES) {
              // Small exponential backoff: 200ms, 400ms
              await sleep(200 * attempt);
            }
          }
        }

        if (enrichmentError !== null || preview === null) {
          // All 3 attempts failed with transient errors.
          await tx
            .update(importRows)
            .set({
              status: "failed",
              errorReason: "enrichment_unavailable",
              updatedAt: new Date(),
            })
            .where(eq(importRows.id, row.id));
          errorsInChunk++;
          processedInChunk++;
          continue;
        }

        // Merge: CSV values take precedence over enriched values (REQ-10-02).
        // coerceNull maps undefined → null to satisfy exactOptionalPropertyTypes
        // (optional fields are typed `T | null`, not `T | null | undefined`).
        const coerceNull = <T>(v: T | null | undefined): T | null => v ?? null;
        finalRecord = {
          isbn13: cleanIsbn,
          title: coerceNull(mergeField(row.title, preview.record.title)),
          authors: coerceNull(mergeField(row.authors, preview.record.authors)),
          year: coerceNull(mergeField(row.year, preview.record.year)),
          publisher: coerceNull(mergeField(row.publisher, preview.record.publisher)),
          pageCount: coerceNull(mergeField(row.pageCount, preview.record.pageCount)),
          subjects: coerceNull(mergeField(row.subjects, preview.record.subjects)),
          language: coerceNull(mergeField(row.language, preview.record.language)),
          description: coerceNull(mergeField(row.description, preview.record.description)),
        };
      } else {
        // No ISBN provided: require both title and author
        skipEnrichment = true;
        if (!row.title || !row.authors || row.authors.length === 0) {
          await tx
            .update(importRows)
            .set({
              status: "failed",
              errorReason: "Missing required fields: isbn13 or both title and author",
              updatedAt: new Date(),
            })
            .where(eq(importRows.id, row.id));
          errorsInChunk++;
          processedInChunk++;
          continue;
        }

        finalRecord = {
          title: row.title,
          authors: row.authors,
          year: row.year,
          publisher: row.publisher,
          pageCount: row.pageCount,
          subjects: row.subjects,
          language: row.language,
          description: row.description,
        };
      }

      // §8 edge case: truncate description > 4000 chars with a non-fatal notice.
      if (
        typeof finalRecord.description === "string" &&
        finalRecord.description.length > DESCRIPTION_MAX_CHARS
      ) {
        finalRecord.description = finalRecord.description.slice(0, DESCRIPTION_MAX_CHARS);
        rowNotice = `description truncated to ${DESCRIPTION_MAX_CHARS} characters`;
      }

      // Validate the merged book record against the BookRecord Zod Schema
      const validation = BookRecordSchema.safeParse(finalRecord);
      if (!validation.success) {
        const errorReason = validation.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");

        await tx
          .update(importRows)
          .set({
            status: "failed",
            errorReason,
            updatedAt: new Date(),
          })
          .where(eq(importRows.id, row.id));
        errorsInChunk++;
        processedInChunk++;
        continue;
      }

      // If dry run, do not insert into the books catalog
      if (job.dryRun) {
        await tx
          .update(importRows)
          .set({
            status: "imported",
            isbn13: finalRecord.isbn13 ?? null,
            title: finalRecord.title,
            authors: finalRecord.authors,
            year: finalRecord.year ?? null,
            publisher: finalRecord.publisher ?? null,
            pageCount: finalRecord.pageCount ?? null,
            subjects: finalRecord.subjects ?? null,
            language: finalRecord.language ?? null,
            description: finalRecord.description ?? null,
            enrichmentSkipped: skipEnrichment,
            ...(rowNotice ? { errorReason: rowNotice } : {}),
            updatedAt: new Date(),
          })
          .where(eq(importRows.id, row.id));
      } else {
        // Insert into books catalog; REQ-10-03: set enrichmentSkipped on books row.
        const [newBook] = await tx
          .insert(books)
          .values({
            tenantId,
            isbn13: finalRecord.isbn13 ?? null,
            title: finalRecord.title ?? "",
            authors: finalRecord.authors ?? [],
            year: finalRecord.year ?? null,
            publisher: finalRecord.publisher ?? null,
            pageCount: finalRecord.pageCount ?? null,
            subjects: finalRecord.subjects ?? null,
            language: finalRecord.language ?? null,
            description: finalRecord.description ?? null,
            enrichmentSkipped: skipEnrichment,
          })
          .returning({ id: books.id });

        if (!newBook) {
          throw new Error("Failed to insert book");
        }

        await writeAuditLog(tx, tenantCtx, {
          action: "book.created",
          subjectType: "book",
          subjectId: newBook.id,
          afterJson: finalRecord,
        });

        await tx
          .update(importRows)
          .set({
            status: "imported",
            isbn13: finalRecord.isbn13 ?? null,
            title: finalRecord.title,
            authors: finalRecord.authors,
            year: finalRecord.year ?? null,
            publisher: finalRecord.publisher ?? null,
            pageCount: finalRecord.pageCount ?? null,
            subjects: finalRecord.subjects ?? null,
            language: finalRecord.language ?? null,
            description: finalRecord.description ?? null,
            enrichmentSkipped: skipEnrichment,
            existingBookId: newBook.id,
            ...(rowNotice ? { errorReason: rowNotice } : {}),
            updatedAt: new Date(),
          })
          .where(eq(importRows.id, row.id));

        newBookIds.push(newBook.id);
      }

      processedInChunk++;
    } catch (err) {
      // Propagate budget errors to trigger quota pausing
      if (err instanceof AiBudgetExceededError || err instanceof AiBudgetNotConfiguredError) {
        throw err;
      }

      // Log other row-level transient/unexpected errors and keep processing remaining rows
      console.warn(`[import-chunk] Row ${row.rowIndex} failed processing:`, err);
      const msg = err instanceof Error ? err.message : String(err);
      await tx
        .update(importRows)
        .set({
          status: "failed",
          errorReason: msg,
          updatedAt: new Date(),
        })
        .where(eq(importRows.id, row.id));
      errorsInChunk++;
      processedInChunk++;
    }
  }

  // Update overall job counts
  await tx
    .update(importJobs)
    .set({
      processedRows: sql`${importJobs.processedRows} + ${processedInChunk}`,
      errorCount: sql`${importJobs.errorCount} + ${errorsInChunk}`,
      duplicateCount: sql`${importJobs.duplicateCount} + ${duplicatesInChunk}`,
      updatedAt: new Date(),
    })
    .where(eq(importJobs.id, jobId));

  // Determine if there are any remaining pending rows
  const [pendingCheck] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(importRows)
    .where(and(eq(importRows.jobId, jobId), eq(importRows.status, "pending")));

  const pendingCount = pendingCheck?.count ?? 0;

  if (pendingCount === 0) {
    await tx
      .update(importJobs)
      .set({
        status: "completed",
        updatedAt: new Date(),
      })
      .where(eq(importJobs.id, jobId));

    return { complete: true, newBookIds };
  }

  return { complete: false, newBookIds };
}

/**
 * Handles post-import tasks: trickle search embeddings generation and send librarian email.
 * This runs outside of a DB transaction.
 */
export async function finalizeImportJob(
  jobId: string,
  tenantCtx: TenantCtx,
  newBookIds: string[],
): Promise<void> {
  const { tenantId } = tenantCtx;

  try {
    // 1. Fetch completed job and tenant info via system context
    const { job, tenant } = await withSystemTenantTx<{
      job: ImportJobRow | undefined;
      tenant: Tenant | undefined;
    }>(tenantId, async (tx) => {
      const [j] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
      return { job: j, tenant: t };
    });

    if (!job) return;

    // 2. Trickle search embeddings in the background (dry runs do not create books)
    if (!job.dryRun && newBookIds.length > 0) {
      // Trickle embedBook calls sequentially with a slight delay
      for (const bookId of newBookIds) {
        try {
          await withSystemTenantTx(tenantId, async (tx) => {
            await embedBook(tx, {
              tenantId: tenantId as TenantId,
              bookId: bookId as BookId,
            });
          });
        } catch (err) {
          console.warn(`[finalizeImportJob] Failed to generate embedding for book ${bookId}:`, err);
        }
        await sleep(100); // 100ms trickle sleep to avoid AI Gateway overloading
      }
    }

    // 3. Send librarian email notification
    const libraryName = tenant?.name ?? "Stack Library";
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const importUrl = `${appUrl}/books/import`;
    const errorReportUrl = `${appUrl}/api/import/${jobId}/error-report`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background-color: #0b0f19; color: #f3f4f6; border-radius: 12px; border: 1px solid #1f2937;">
        <h2 style="color: #6366f1; font-size: 24px; font-weight: 700; margin-top: 0; margin-bottom: 8px;">Import Process Completed</h2>
        <p style="color: #9ca3af; font-size: 14px; margin-bottom: 24px;">Your CSV catalog import job has completed. Below is the summary of the results.</p>

        <div style="background-color: #111827; border-radius: 8px; padding: 20px; margin-bottom: 24px; border: 1px solid #374151;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #9ca3af; font-size: 14px;">Import Mode</td>
              <td style="padding: 6px 0; text-align: right; color: #6366f1; font-weight: 600; font-size: 14px;">${job.dryRun ? "Dry Run (Preview)" : "Live Import"}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #9ca3af; font-size: 14px;">Total Rows</td>
              <td style="padding: 6px 0; text-align: right; color: #f3f4f6; font-weight: 600; font-size: 14px;">${job.totalRows}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #9ca3af; font-size: 14px;">Imported Successfully</td>
              <td style="padding: 6px 0; text-align: right; color: #10b981; font-weight: 600; font-size: 14px;">${job.processedRows - job.errorCount - job.duplicateCount}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #9ca3af; font-size: 14px;">Duplicates Flagged</td>
              <td style="padding: 6px 0; text-align: right; color: #f59e0b; font-weight: 600; font-size: 14px;">${job.duplicateCount}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #9ca3af; font-size: 14px;">Errors Encountered</td>
              <td style="padding: 6px 0; text-align: right; color: #ef4444; font-weight: 600; font-size: 14px;">${job.errorCount}</td>
            </tr>
          </table>
        </div>

        ${
          job.errorCount > 0
            ? `
          <div style="margin-bottom: 28px;">
            <p style="color: #ef4444; font-size: 14px; margin-bottom: 12px; font-weight: 500;">Some rows failed to import. You can download the error report below to fix and re-upload them.</p>
            <a href="${errorReportUrl}" style="display: inline-block; background-color: #ef4444; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 600; font-size: 14px;">Download Error Report CSV</a>
          </div>
        `
            : ""
        }

        <div style="border-top: 1px solid #1f2937; padding-top: 20px; font-size: 12px; color: #6b7280; text-align: center;">
          <p style="margin: 0;">Sent automatically by ${libraryName} Catalog Management.</p>
          <p style="margin: 4px 0 0 0;"><a href="${importUrl}" style="color: #6366f1; text-decoration: none;">View Import Job History</a></p>
        </div>
      </div>
    `;

    await sendEmail({
      to: job.createdBy,
      subject: `Import Job Completed: ${job.dryRun ? "[Dry Run] " : ""}${job.processedRows - job.errorCount - job.duplicateCount} books imported`,
      html: htmlContent,
    });
  } catch (err) {
    console.error("[finalizeImportJob] Failed to finalize import job:", err);
  }
}
