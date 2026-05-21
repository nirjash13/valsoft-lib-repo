/**
 * previewIsbn — orchestrates the full ISBN enrichment flow (REQ-02-01).
 *
 * Flow:
 *   1. Normalize ISBN (strip dashes/spaces, convert ISBN-10 → ISBN-13)
 *   2. Validate checksum (throws IsbnInvalidError on failure)
 *   3. Cache lookup — on hit, return immediately (NFR-02-02: 200 ms cached)
 *   4. On cache miss: fan out to Open Library + Google Books in parallel,
 *      each with a 3-second AbortController timeout (REQ-02-01 c)
 *   5. Merge results (OL wins; GB fills gaps; sourcesDiff for year disagreements)
 *   6. Optional LLM normalization (only when AI_ENRICH_ENABLED=true and
 *      no LLM error — NFR-02-03: falls back to merged blob on LLM error)
 *   7. Cache the result
 *   8. Return preview to the caller (no DB write; createBook does that)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertAiBudget } from "@/lib/ai/budget";
import { generateObjectViaGateway } from "@/lib/ai/gateway";
import type { TenantId } from "@/lib/db/schema/_shared";
import type { TxClient } from "@/lib/db/with-tenant-tx";
import { normalizeIsbn } from "./isbn";
import { getCached, putCached } from "./isbn-cache";
import type { BookRecord } from "./schemas";
import { BookRecordSchema } from "./schemas";
import { fetchFromGoogleBooks } from "./sources/google-books";
import { merge } from "./sources/merge";
import type { SourcesDiff } from "./sources/merge";
import { fetchFromOpenLibrary } from "./sources/open-library";

// ---------------------------------------------------------------------------
// PreviewResult
// ---------------------------------------------------------------------------

export interface PreviewResult {
  isbn13: string;
  record: Partial<BookRecord>;
  sourcesDiff: SourcesDiff;
  /** True if the result came from the ISBN cache (no external fetch). */
  fromCache: boolean;
}

// ---------------------------------------------------------------------------
// Load prompt (static, loaded once at module init)
// ---------------------------------------------------------------------------

let _promptBody: string | undefined;

function getPromptBody(): string {
  if (_promptBody) return _promptBody;
  const promptPath = join(process.cwd(), "lib/ai/prompts/isbn-enrich.md");
  const raw = readFileSync(promptPath, "utf-8");
  // Strip YAML frontmatter (--- ... ---)
  _promptBody = raw.replace(/^---[\s\S]*?---\n/, "").trim();
  return _promptBody;
}

// ---------------------------------------------------------------------------
// previewIsbn
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 3000;

/**
 * Returns an enriched book preview for the given raw ISBN input.
 *
 * @param tx       - Active tenant transaction (for cache read/write).
 * @param tenantId - The current tenant UUID (for cache scoping + AI budget).
 * @param rawIsbn  - Raw user input (may include dashes, spaces; ISBN-10 or ISBN-13).
 * @returns PreviewResult (never throws on enrichment miss — returns partial record).
 * @throws IsbnInvalidError if the ISBN checksum is invalid.
 */
export async function previewIsbn(
  tx: TxClient,
  tenantId: TenantId,
  rawIsbn: string,
): Promise<PreviewResult> {
  // Step 1+2: normalize and validate
  const isbn13 = normalizeIsbn(rawIsbn);

  // Step 3: cache lookup
  const cached = await getCached(tx, tenantId, isbn13);
  if (cached) {
    return { isbn13, record: cached, sourcesDiff: {}, fromCache: true };
  }

  // Step 4: parallel fan-out with per-source 3s timeout
  const olController = new AbortController();
  const gbController = new AbortController();
  const olTimer = setTimeout(() => olController.abort(), FETCH_TIMEOUT_MS);
  const gbTimer = setTimeout(() => gbController.abort(), FETCH_TIMEOUT_MS);

  const [olResult, gbResult] = await Promise.allSettled([
    fetchFromOpenLibrary(isbn13, olController.signal),
    fetchFromGoogleBooks(isbn13, gbController.signal),
  ]);

  clearTimeout(olTimer);
  clearTimeout(gbTimer);

  const ol = olResult.status === "fulfilled" ? olResult.value : null;
  const gb = gbResult.status === "fulfilled" ? gbResult.value : null;

  // Step 5: merge
  const { merged, sourcesDiff } = merge(ol, gb);

  // Step 6: optional LLM normalization
  let finalRecord: Partial<BookRecord> = merged;
  const aiEnabled = process.env.AI_ENRICH_ENABLED === "true";

  if (aiEnabled && Object.keys(merged).length > 0) {
    // Budget pre-check must propagate — a cap=0 tenant must not silently bypass it.
    // AiBudgetExceededError / AiBudgetNotConfiguredError surface to the Server Action
    // which maps them via handleServerError → 402. Do NOT wrap this in try/catch.
    await assertAiBudget(tenantId, 0.001); // est ~$0.001 for haiku

    try {
      const systemPrompt = getPromptBody();
      const normalized = await generateObjectViaGateway({
        model: "anthropic/claude-haiku-4-5",
        schema: BookRecordSchema.partial(),
        system: systemPrompt,
        prompt: JSON.stringify(merged),
        tenantId,
        feature: "isbn-enrich",
      });
      // exactOptionalPropertyTypes: filter out undefined values from the LLM result
      // before assigning, so we don't set explicitly-undefined optional props.
      finalRecord = Object.fromEntries(
        Object.entries(normalized).filter(([, v]) => v !== undefined),
      ) as Partial<BookRecord>;
    } catch (err) {
      // NFR-02-03: fall back to merged blob when the LLM step fails (timeout, model
      // error, validation failure, or gateway-not-configured deployment issue).
      // Log so ops can detect misconfiguration — do not swallow silently.
      console.warn("[isbn-enrich] LLM step failed; falling back to merged blob", err);
      finalRecord = merged;
    }
  }

  // Ensure isbn13 is always in the result (isbn13 is validated and non-undefined here)
  const record: Partial<BookRecord> = { ...finalRecord };
  record.isbn13 = isbn13;

  // Step 7: cache (even empty results — prevents hammering APIs for unknown ISBNs)
  await putCached(tx, tenantId, isbn13, record);

  return { isbn13, record, sourcesDiff, fromCache: false };
}
