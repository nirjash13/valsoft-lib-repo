import crypto from "node:crypto";
import { buildAbility } from "@/lib/auth/ability";
import { getSession, sessionToTenantCtx } from "@/lib/auth/session";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import {
  EXPORT_BATCH_SIZE,
  type ExportMetadata,
  formatCSVRow,
  generateExportSignature,
} from "@/lib/domain/reporting/exporter";
import { sql } from "drizzle-orm";

const WHITELISTED_VIEWS = new Set([
  "overview_kpis",
  "top_circulated_this_week",
  "circulation_by_day",
  "top_borrowers",
  "top_books_detailed",
  "loan_duration_stats",
  "zero_result_searches",
  "member_status_stats",
  "member_signups_by_week",
  "member_churn_proxy",
  "chat_refusals_24h",
  "ai_latency_and_quota",
  "audit_logs_timeline",
]);

/**
 * Streaming export endpoint for reporting dashboards.
 *
 * Spec 08 edge-case: "Export of 100k+ rows → stream as ndjson + CSV;
 * do not buffer in memory."
 *
 * Implementation:
 *   1. Auth + validation happen synchronously (errors → proper HTTP status).
 *   2. A TransformStream is opened and the readable side returned immediately.
 *   3. Inside a `withTenantTx` callback, a PostgreSQL DECLARE CURSOR walks
 *      the reporting view in batches of EXPORT_BATCH_SIZE rows.
 *   4. Each batch is formatted (CSV rows or ndjson lines) and written to the
 *      stream writer, which applies backpressure automatically.
 *   5. A SHA-256 hash is computed incrementally over the data payload.
 *   6. After the last batch, the hash + HMAC signature are appended as
 *      trailing lines (tamper-evidence per NFR-08-04).
 */
export async function GET(req: Request): Promise<Response> {
  // -----------------------------------------------------------------------
  // 1. Auth & validation (synchronous — errors return proper HTTP status)
  // -----------------------------------------------------------------------
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const ability = buildAbility(session.roles);
  if (!ability.can("view", "Report")) {
    return new Response("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const view = searchParams.get("viewName");
  const format = searchParams.get("format") || "csv";

  if (!view || !WHITELISTED_VIEWS.has(view)) {
    return new Response("Invalid viewName parameter", { status: 400 });
  }

  let tenantCtx: Awaited<ReturnType<typeof sessionToTenantCtx>>;
  try {
    tenantCtx = await sessionToTenantCtx(session);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`Session error: ${msg}`, { status: 500 });
  }

  const metadata: ExportMetadata = {
    tenantId: tenantCtx.tenantId,
    timestamp: new Date().toISOString(),
    viewName: view,
  };

  const isNdjson = format === "json";
  const fileExt = isNdjson ? "ndjson" : "csv";
  const contentType = isNdjson ? "application/x-ndjson" : "text/csv";
  const filename = `${view}_export_${metadata.timestamp.replace(/[:.]/g, "-")}.${fileExt}`;

  // -----------------------------------------------------------------------
  // 2. Create a streaming response with backpressure support
  // -----------------------------------------------------------------------
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // -----------------------------------------------------------------------
  // 3. Stream data in the background using cursor-based batching
  // -----------------------------------------------------------------------
  const streamExport = async () => {
    try {
      await withTenantTx(tenantCtx, async (tx) => {
        // Open a server-side cursor over the whitelisted view.
        // The view name is safe — it was validated against WHITELISTED_VIEWS above.
        const viewFqn = `reporting.${view}`;
        await tx.execute(
          sql`DECLARE export_cursor NO SCROLL CURSOR FOR SELECT * FROM ${sql.raw(viewFqn)}`,
        );

        const hash = crypto.createHash("sha256");
        let headers: string[] | null = null;

        // CSV preamble: metadata as comment lines (hash follows at end of file)
        if (!isNdjson) {
          await writer.write(
            encoder.encode(
              `# tenant_id: ${metadata.tenantId}\n# timestamp: ${metadata.timestamp}\n`,
            ),
          );
        }

        // Fetch and stream in batches
        while (true) {
          const batch = await tx.execute(
            sql`FETCH ${sql.raw(String(EXPORT_BATCH_SIZE))} FROM export_cursor`,
          );
          const rows = (batch.rows as Record<string, unknown>[]) || [];
          if (rows.length === 0) break;

          // First batch: emit column headers (CSV) or skip (ndjson)
          if (!headers && rows[0]) {
            headers = Object.keys(rows[0]);
            if (!isNdjson) {
              const headerLine = `${headers.join(",")}\n`;
              hash.update(headerLine);
              await writer.write(encoder.encode(headerLine));
            }
          }

          // Stream each row
          for (const row of rows) {
            const line = isNdjson
              ? `${JSON.stringify(row)}\n`
              : `${formatCSVRow(row, headers!)}\n`;
            hash.update(line);
            await writer.write(encoder.encode(line));
          }
        }

        await tx.execute(sql`CLOSE export_cursor`);

        // Append trailing hash + HMAC signature for tamper-evidence (NFR-08-04)
        const hashHex = hash.digest("hex");
        const sig = generateExportSignature(metadata, hashHex);

        if (isNdjson) {
          // ndjson: final line is a metadata record distinguishable by __export_metadata key
          const footer = JSON.stringify({
            __export_metadata: { ...metadata, hash: hashHex, signature: sig },
          });
          await writer.write(encoder.encode(`${footer}\n`));
        } else {
          // CSV: trailing comment lines matching the preamble convention
          await writer.write(
            encoder.encode(`# hash: ${hashHex}\n# signature: ${sig}\n`),
          );
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Streaming export failed:", msg);
      // Best-effort error indicator appended to the stream
      await writer.write(encoder.encode(`\n# error: ${msg}\n`));
    } finally {
      await writer.close();
    }
  };

  // Fire the streaming pipeline — it runs concurrently with response delivery.
  // The transaction stays open until all batches are streamed and the writer
  // is closed, at which point withTenantTx commits.
  streamExport();

  return new Response(readable, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache",
    },
  });
}
