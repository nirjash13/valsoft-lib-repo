/**
 * GET /api/catalog/:tenant/books/:bookId — Public book detail (Spec 09 REQ-09-04).
 *
 * Unauthenticated: middleware bypasses auth for /api/catalog/** paths.
 * Tenant isolation: resolved via slug → withSystemTenantTx + RLS FORCE.
 * No Set-Cookie (REQ-09-01): response has no session cookie.
 * Cache: s-maxage=60 with stale-while-revalidate (NFR-09-01).
 *
 * Returns: PublicBookDetail (single book with availability)
 */

export const runtime = "nodejs";

import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import {
  CatalogDisabledError,
  PublicBookNotFoundError,
  TenantNotFoundError,
} from "@/lib/domain/catalog/errors";
import { requirePublicCatalog } from "@/lib/domain/catalog/resolve-tenant-by-slug";
import type { TenantCatalogConfig } from "@/lib/domain/catalog/resolve-tenant-by-slug";
import { getPublicBook } from "@/lib/domain/catalog/service";
import { problem } from "@/lib/http/problem";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tenant: string; bookId: string }> },
): Promise<Response> {
  const { tenant: slug, bookId } = await params;

  // --- Validate bookId format ---
  if (!UUID_REGEX.test(bookId)) {
    return problem(400, "Bad Request", "bookId must be a valid UUID", "INVALID_BOOK_ID");
  }

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

  // --- Fetch book ---
  try {
    const book = await withSystemTenantTx(config.tenantId, (tx) =>
      getPublicBook(tx, bookId, config.publicCatalogSubjectBlocklist),
    );

    return new Response(JSON.stringify(book), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    if (err instanceof PublicBookNotFoundError) {
      return problem(404, "Not Found", err.message, "BOOK_NOT_FOUND");
    }
    // Map RLS-raise (insufficient_privilege on tenant mismatch) to 404 rather than 500
    // so callers don't see internal DB errors leaking out (REQ-09-07, REQ-09-06).
    if (err instanceof Error && err.message.includes("insufficient_privilege")) {
      return problem(404, "Not Found", "Book not found in this catalog", "BOOK_NOT_FOUND");
    }
    return problem(500, "Internal Server Error", undefined, "INTERNAL_ERROR");
  }
}
