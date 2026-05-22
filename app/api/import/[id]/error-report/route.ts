/**
 * GET /api/import/[id]/error-report — downloads a CSV of failed rows for a given import job.
 *
 * [MEDIUM NFR-10-04] Uses a fixed canonical header set derived from the spec §3 supported
 * columns, so re-upload shape is stable regardless of what columns the original CSV contained.
 */

import { buildAbility } from "@/lib/auth/ability";
import { getSession, sessionToTenantCtx } from "@/lib/auth/session";
import { importJobs } from "@/lib/db/schema/import-jobs";
import { importRows } from "@/lib/db/schema/import-rows";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { and, eq } from "drizzle-orm";

/** Canonical column order from Spec 10 §3 — fixed, never derived from rawData keys. */
const CANONICAL_HEADERS = [
  "isbn13",
  "title",
  "authors",
  "year",
  "publisher",
  "page_count",
  "subjects",
  "language",
  "description",
] as const;

function escapeCsvCell(val: string | null | undefined): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: jobId } = await params;

  // 1. Authenticate session
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Authorize permission
  const ability = buildAbility(session.roles);
  if (!ability.can("read", "Book")) {
    return new Response("Forbidden", { status: 403 });
  }

  const tenantCtx = await sessionToTenantCtx(session);

  // 3. Query job and failed rows inside the tenant isolation context
  const data = await withTenantTx(tenantCtx, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);

    if (!job) return null;

    const failedRows = await tx
      .select()
      .from(importRows)
      .where(and(eq(importRows.jobId, jobId), eq(importRows.status, "failed")))
      .orderBy(importRows.rowIndex);

    return { job, failedRows };
  });

  if (!data) {
    return new Response("Not Found", { status: 404 });
  }

  const { failedRows } = data;

  // 4. Build CSV using canonical header set (spec §3) + error column
  const csvHeaders = [...CANONICAL_HEADERS, "error"] as const;
  const headerLine = `${csvHeaders.map(escapeCsvCell).join(",")}\r\n`;

  // 5. Construct streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(headerLine));

      for (const row of failedRows) {
        const line = `${csvHeaders
          .map((h) => {
            if (h === "error") {
              return escapeCsvCell(row.errorReason);
            }
            // Read from rawData using canonical column name
            const rawVal = row.rawData[h];
            return escapeCsvCell(rawVal);
          })
          .join(",")}\r\n`;

        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="import_errors_${jobId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
