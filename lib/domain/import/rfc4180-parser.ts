/**
 * RFC-4180 compliant CSV parser.
 * Supports:
 *   - Quoted fields with commas, carriage returns, and line feeds.
 *   - Escaped double quotes (double-double quotes `""`).
 *   - Windows (\r\n), Unix (\n), and Mac (\r) line endings.
 *   - BOM removal.
 */
export function parseCsv(text: string): Record<string, string>[] {
  if (!text) return [];

  // Strip UTF-8 BOM if present
  let cleanText = text;
  if (cleanText.startsWith("\uFEFF")) {
    cleanText = cleanText.substring(1);
  }

  const lines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const c = cleanText[i];
    const next = cleanText[i + 1];

    if (inQuotes) {
      if (c === '"') {
        if (next === '"') {
          field += '"';
          i++; // Skip the next quote character
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\r" || c === "\n") {
        row.push(field);
        field = "";
        // Only push non-empty rows (ignoring trailing newline row gaps)
        if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
          lines.push(row);
        }
        row = [];
        if (c === "\r" && next === "\n") {
          i++; // Skip LF in CRLF pair
        }
      } else {
        field += c;
      }
    }
  }

  // Push final cell and row
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
      lines.push(row);
    }
  }

  if (lines.length === 0) return [];

  const firstLine = lines[0];
  if (!firstLine) return [];

  // Parse headers from first row
  const headers = firstLine.map((h) => h.trim().toLowerCase());
  const results: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const currentRow = lines[i];
    if (!currentRow) continue;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (header) {
        // Map current row cell to header or default to empty string if undefined
        obj[header] = (currentRow[j] ?? "").trim();
      }
    }
    results.push(obj);
  }

  return results;
}
