import { BookCard } from "@/components/app/book-card";
import { Button } from "@/components/ui/button";
import { buildAbility } from "@/lib/auth/ability";
import { requireSession } from "@/lib/auth/session";
import { sessionToTenantCtx } from "@/lib/auth/session";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { listBooks } from "@/lib/domain/books/list-books";
import { Plus } from "lucide-react";
import Link from "next/link";
import { BooksSearch } from "./books-search";

interface BooksPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

/**
 * Books list page — RSC query.
 *
 * Reads books for the current tenant via withTenantTx (REQ-02-06 — soft-deleted
 * books are excluded by default). Supports basic text search (q param) and
 * pagination (page param, 48 per page).
 */
export default async function BooksPage({ searchParams }: BooksPageProps) {
  const params = await searchParams;
  const query = params.q ?? "";
  const page = Math.max(1, Number(params.page ?? 1));
  const perPage = 48;
  const offset = (page - 1) * perPage;

  const session = await requireSession();
  const tenantCtx = await sessionToTenantCtx(session);
  const ability = buildAbility(session.roles);
  const canCreate = ability.can("create", "Book");

  const books = await withTenantTx(tenantCtx, (tx) =>
    listBooks(tx, { query, includeDeleted: false, limit: perPage, offset }),
  );

  return (
    <div className="max-w-[1200px] mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-h1 text-text-primary">Books</h1>
          <p className="text-meta text-text-secondary mt-1">
            {books.length} book{books.length !== 1 ? "s" : ""}
            {query ? ` matching "${query}"` : ""}
          </p>
        </div>

        {canCreate && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" asChild>
              <Link href="/books/import">Import CSV</Link>
            </Button>
            <Button asChild>
              <Link href="/books/new">
                <Plus className="h-4 w-4" aria-hidden />
                Add Book
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Search bar */}
      <div className="mb-6">
        <BooksSearch defaultValue={query} />
      </div>

      {/* Book grid */}
      {books.length === 0 ? (
        <EmptyState query={query} canCreate={canCreate} />
      ) : (
        <ul
          className="grid gap-4 list-none m-0 p-0"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          }}
          aria-label="Book catalog"
        >
          {books.map((book) => (
            <li key={book.id}>
              <BookCard book={book} />
            </li>
          ))}
        </ul>
      )}

      {/* Pagination hint */}
      {books.length === perPage && (
        <div className="mt-8 flex justify-center gap-3">
          {page > 1 && (
            <Button variant="secondary" asChild>
              <Link href={`/books?q=${encodeURIComponent(query)}&page=${page - 1}`}>Previous</Link>
            </Button>
          )}
          <Button variant="secondary" asChild>
            <Link href={`/books?q=${encodeURIComponent(query)}&page=${page + 1}`}>Next page</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ query, canCreate }: { query: string; canCreate: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 text-3xl"
        style={{ background: "hsl(212 40% 18%)" }}
        aria-hidden
      >
        📚
      </div>
      <p className="text-h3 text-text-primary mb-2">
        {query ? `No books matching "${query}"` : "No books yet."}
      </p>
      <p className="text-body text-text-secondary mb-6">
        {query
          ? "Try a different search term, or clear the filter."
          : "Scan an ISBN or fill the form to get started."}
      </p>
      {canCreate && !query && (
        <Button asChild>
          <Link href="/books/new">
            <Plus className="h-4 w-4" aria-hidden />
            Add by ISBN
          </Link>
        </Button>
      )}
    </div>
  );
}
