import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { listBooks } from "@/lib/domain/books/list-books";
import { ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TrashTable } from "./trash-table";

/**
 * Trash view — shows soft-deleted books within the 30-day retention window.
 *
 * Access: only tenant_admin (book:delete) — librarians cannot see Trash.
 * Returns 404 for users without the permission (don't reveal the endpoint).
 */
export default async function TrashPage() {
  const session = await requireSession();
  const tenantCtx = await sessionToTenantCtx(session);
  const ability = buildAbility(session.roles);

  // Only tenant_admin has book:delete — required to restore
  if (!ability.can("delete", "Book")) {
    notFound();
  }

  const deletedBooks = await withTenantTx(tenantCtx, (tx) =>
    listBooks(tx, { includeDeleted: true, limit: 200, offset: 0 }),
  );

  return (
    <div className="max-w-[960px] mx-auto">
      {/* Header */}
      <Link
        href="/books"
        className="inline-flex items-center gap-1.5 text-meta text-text-secondary hover:text-text-primary mb-6 transition-instant transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to Books
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-h1 text-text-primary flex items-center gap-2">
            <Trash2 className="h-7 w-7 text-danger" aria-hidden />
            Trash
          </h1>
          <p className="text-meta text-text-secondary mt-1">
            Deleted books are restored within 30 days. After that, they are anonymized.
          </p>
        </div>
        <div className="text-meta text-text-secondary">
          {deletedBooks.length} item{deletedBooks.length !== 1 ? "s" : ""}
        </div>
      </div>

      {deletedBooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-h3 text-text-primary mb-2">Trash is empty</p>
          <p className="text-body text-text-secondary">
            Removed books appear here and can be restored within 30 days.
          </p>
        </div>
      ) : (
        <TrashTable books={deletedBooks} />
      )}
    </div>
  );
}
