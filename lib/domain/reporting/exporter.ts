import crypto from "node:crypto";

const EXPORT_SIGNING_SECRET =
  process.env.EXPORT_SIGNING_SECRET || "dev-export-signing-secret-key-1234567890";

export interface ExportMetadata {
  tenantId: string;
  timestamp: string;
  viewName: string;
}

/**
 * Computes a SHA-256 HMAC signature of the metadata and payload hash.
 */
export function generateExportSignature(metadata: ExportMetadata, payloadHash: string): string {
  const dataToSign = `${metadata.tenantId}:${metadata.timestamp}:${metadata.viewName}:${payloadHash}`;
  return crypto.createHmac("sha256", EXPORT_SIGNING_SECRET).update(dataToSign).digest("hex");
}

/**
 * Computes SHA-256 hash of a string payload.
 */
export function computePayloadHash(payload: string): string {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Formats rows as CSV string, including the tamper-evident header.
 */
export function formatCSV(metadata: ExportMetadata, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    const emptyBody = "";
    const hash = computePayloadHash(emptyBody);
    const sig = generateExportSignature(metadata, hash);
    return `# tenant_id: ${metadata.tenantId}\n# timestamp: ${metadata.timestamp}\n# hash: ${hash}\n# signature: ${sig}\n`;
  }

  const firstRow = rows[0];
  if (!firstRow) {
    return "";
  }
  const headers = Object.keys(firstRow);
  const csvRows = rows.map((row) =>
    headers
      .map((header) => {
        const val = row[header];
        if (val === null || val === undefined) return "";
        const str = typeof val === "object" ? JSON.stringify(val) : String(val);
        // Escape double quotes
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(","),
  );

  const csvBody = [headers.join(","), ...csvRows].join("\n");
  const hash = computePayloadHash(csvBody);
  const sig = generateExportSignature(metadata, hash);

  return `# tenant_id: ${metadata.tenantId}\n# timestamp: ${metadata.timestamp}\n# hash: ${hash}\n# signature: ${sig}\n${csvBody}`;
}

/**
 * Formats rows as JSON string, including the tamper-evident header.
 */
export function formatJSON(metadata: ExportMetadata, rows: Record<string, unknown>[]): string {
  const jsonBody = JSON.stringify(rows, null, 2);
  const hash = computePayloadHash(jsonBody);
  const sig = generateExportSignature(metadata, hash);

  const exportObj = {
    metadata: {
      tenantId: metadata.tenantId,
      timestamp: metadata.timestamp,
      viewName: metadata.viewName,
      hash,
      signature: sig,
    },
    data: rows,
  };

  return JSON.stringify(exportObj, null, 2);
}

/**
 * Verifies if an exported JSON file is authentic.
 */
export function verifyJSONExport(exportObj: {
  metadata?: {
    tenantId?: string;
    timestamp?: string;
    viewName?: string;
    hash?: string;
    signature?: string;
  };
  data?: unknown;
}): boolean {
  if (!exportObj?.metadata || !exportObj?.data) return false;
  const { tenantId, timestamp, viewName, hash, signature } = exportObj.metadata;
  const jsonBody = JSON.stringify(exportObj.data, null, 2);
  const computedHash = computePayloadHash(jsonBody);
  if (computedHash !== hash) return false;

  const expectedSig = generateExportSignature(
    {
      tenantId: tenantId ?? "",
      timestamp: timestamp ?? "",
      viewName: viewName ?? "",
    },
    hash,
  );
  return expectedSig === signature;
}

// ---------------------------------------------------------------------------
// Streaming export helpers
// ---------------------------------------------------------------------------

/**
 * Batch size for cursor-based streaming exports.
 * Balances memory usage (~5k rows in memory per batch) vs DB round-trips.
 */
export const EXPORT_BATCH_SIZE = 5000;

/**
 * Formats a single record as a CSV-escaped line (without trailing newline).
 * Used by the streaming export route to avoid building the full CSV in memory.
 */
export function formatCSVRow(row: Record<string, unknown>, headers: string[]): string {
  return headers
    .map((header) => {
      const val = row[header];
      if (val === null || val === undefined) return "";
      const str = typeof val === "object" ? JSON.stringify(val) : String(val);
      return `"${str.replace(/"/g, '""')}"`;
    })
    .join(",");
}
