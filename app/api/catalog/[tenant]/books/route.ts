/**
 * GET /api/catalog/:tenant/books — Public book list (Spec 09 REQ-09-01).
 *
 * Unauthenticated: middleware bypasses auth for /api/catalog/** paths.
 * Lexical-only search: no LLM or embedding API call (REQ-09-03, NFR-09-02).
 * Tenant isolation: resolved via slug → withSystemTenantTx + RLS FORCE.
 * No Set-Cookie (REQ-09-01): response has no session cookie.
 * Cache: s-maxage=60 with stale-while-revalidate (NFR-09-01).
 *
 * Returns: { books: PublicBook[], totalCount: number }
 */

export const runtime = "nodejs";

import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import { CatalogDisabledError, TenantNotFoundError } from "@/lib/domain/catalog/errors";
import { requirePublicCatalog } from "@/lib/domain/catalog/resolve-tenant-by-slug";
import type { TenantCatalogConfig } from "@/lib/domain/catalog/resolve-tenant-by-slug";
import { PublicBookListInputSchema } from "@/lib/domain/catalog/schemas";
import { listPublicBooks } from "@/lib/domain/catalog/service";
import { problem } from "@/lib/http/problem";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ tenant: string }> },
): Promise<Response> {
  const { tenant: slug } = await params;

  // --- Resolve tenant + check enabled ---
  let config: TenantCatalogConfig;
  try {
    config = await requirePublicCatalog(slug);
  } catch (err) {
    if (err instanceof TenantNotFoundError || err instanceof CatalogDisabledError) {
      return problem(404, "Not Found", "Public catalog not available", "CATALOG_NOT_FOUND");
    }
    return problem(500, "Internal Server Error", undefined, "INTERNAL_ERROR");
  }

  // --- Parse query string ---
  const url = new URL(req.url);
  const rawInput = {
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    subjects: url.searchParams.get("subjects") ?? undefined,
    language: url.searchParams.get("language") ?? undefined,
  };

  const parsed = PublicBookListInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return problem(
      422,
      "Unprocessable Entity",
      parsed.error.issues.map((i) => i.message).join("; "),
      "VALIDATION_ERROR",
    );
  }

  // --- Execute query ---
  try {
    const response = await withSystemTenantTx(config.tenantId, (tx) =>
      listPublicBooks(tx, parsed.data, config.publicCatalogSubjectBlocklist),
    );

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch {
    return problem(500, "Internal Server Error", undefined, "INTERNAL_ERROR");
  }
}
