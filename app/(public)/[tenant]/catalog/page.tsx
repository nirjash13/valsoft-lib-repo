import { Button } from "@/components/ui/button";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import {
  type TenantCatalogConfig,
  requirePublicCatalog,
} from "@/lib/domain/catalog/resolve-tenant-by-slug";
import { listPublicBooks } from "@/lib/domain/catalog/service";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogSearch } from "./catalog-search";
import { PublicBookCard } from "./public-book-card";

interface CatalogPageProps {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}

export const revalidate = 60; // Cache this browse page at the edge for 60 seconds (ISR)

/**
 * Public catalog browse page.
 *
 * Implements REQ-09-01, REQ-09-02, REQ-09-03 (lexical-only search).
 */
export default async function CatalogPage({ params, searchParams }: CatalogPageProps) {
  const { tenant: slug } = await params;
  const sParams = await searchParams;

  const query = sParams.q ?? "";
  const page = Math.max(1, Number(sParams.page ?? 1));
  const limit = 24; // clean multiple for grids
  const offset = (page - 1) * limit;

  // 1. Resolve tenant & assert public catalog is enabled
  let config: TenantCatalogConfig;
  try {
    config = await requirePublicCatalog(slug);
  } catch (_err) {
    notFound();
  }

  // 2. Fetch books under RLS (using system transaction, lexical-only search)
  const { books, totalCount } = await withSystemTenantTx(config.tenantId, (tx) =>
    listPublicBooks(tx, { q: query, limit, offset }, config.publicCatalogSubjectBlocklist),
  );

  const totalPages = Math.ceil(totalCount / limit);

  return (
    <div className="max-w-[1200px] mx-auto flex flex-col gap-8">
      {/* Hero / Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-6 border-b border-border-subtle">
        <div>
          <h1 className="text-display text-text-primary tracking-tight">Browse our Collection</h1>
          <p className="text-body text-text-secondary mt-2">
            Explore the available books at{" "}
            <span className="font-semibold text-text-primary">{config.tenantName}</span>.
          </p>
        </div>

        {/* Search & Statistics */}
        <div className="flex flex-col gap-2 items-end w-full md:w-auto">
          <CatalogSearch defaultValue={query} />
          <p className="text-caption text-text-tertiary">
            {totalCount} book{totalCount !== 1 ? "s" : ""}
            {query ? ` matching "${query}"` : ""}
          </p>
        </div>
      </div>

      {/* Grid of Books */}
      {books.length === 0 ? (
        <EmptyState slug={slug} query={query} />
      ) : (
        <div className="flex flex-col gap-8">
          <ul
            className="grid gap-6 list-none m-0 p-0"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            }}
            aria-label="Public book catalog"
          >
            {books.map((book) => (
              <li key={book.id}>
                <PublicBookCard tenantSlug={slug} book={book} />
              </li>
            ))}
          </ul>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <nav className="flex justify-center items-center gap-4 mt-6" aria-label="Pagination">
              {page > 1 ? (
                <Button variant="secondary" asChild>
                  <Link
                    href={`/${slug}/catalog?q=${encodeURIComponent(query)}&page=${page - 1}`}
                    aria-label="Go to previous page"
                  >
                    Previous
                  </Link>
                </Button>
              ) : (
                <Button variant="secondary" disabled>
                  Previous
                </Button>
              )}

              <span className="text-meta text-text-secondary" data-tabular>
                Page {page} of {totalPages}
              </span>

              {page < totalPages ? (
                <Button variant="secondary" asChild>
                  <Link
                    href={`/${slug}/catalog?q=${encodeURIComponent(query)}&page=${page + 1}`}
                    aria-label="Go to next page"
                  >
                    Next
                  </Link>
                </Button>
              ) : (
                <Button variant="secondary" disabled>
                  Next
                </Button>
              )}
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ slug, query }: { slug: string; query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center bg-surface border border-border-subtle rounded-2xl p-8 max-w-lg mx-auto">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mb-6 text-3xl"
        style={{ background: "hsl(220 13% 13%)" }}
        aria-hidden
      >
        🔍
      </div>
      <h2 className="text-h2 text-text-primary mb-2">No books found</h2>
      <p className="text-body text-text-secondary mb-6">
        {query
          ? `We couldn't find any books matching "${query}". Try checking your spelling or using different keywords.`
          : "This library catalog doesn't have any public books listed yet."}
      </p>
      {query && (
        <Button asChild>
          <Link href={`/${slug}/catalog`}>Clear search filter</Link>
        </Button>
      )}
    </div>
  );
}
