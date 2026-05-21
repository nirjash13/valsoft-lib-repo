import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import type { BookRow } from "@/lib/db/schema/books";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { BookNotFoundError } from "@/lib/domain/books/errors";
import { getBook } from "@/lib/domain/books/get-book";
import { coverGradient } from "@/lib/utils/cover-color";
import { ArrowLeft, Edit, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookActions } from "./book-actions";

interface BookDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Book detail page — RSC query.
 *
 * Renders full metadata for one book. Server-side CASL gate determines which
 * action buttons are shown (Edit, Remove, Restore).
 */
export default async function BookDetailPage({ params }: BookDetailPageProps) {
  const { id } = await params;

  const session = await requireSession();
  const tenantCtx = await sessionToTenantCtx(session);
  const ability = buildAbility(session.roles);

  let book: BookRow;
  try {
    book = await withTenantTx(tenantCtx, (tx) => getBook(tx, id));
  } catch (err) {
    if (err instanceof BookNotFoundError) notFound();
    throw err;
  }

  const canUpdate = ability.can("update", "Book");
  const canDelete = ability.can("delete", "Book");
  const gradient = coverGradient(book.title);
  const isDeleted = book.deletedAt !== null;

  return (
    <div className="max-w-[960px] mx-auto">
      {/* Back link */}
      <Link
        href="/books"
        className="inline-flex items-center gap-1.5 text-meta text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] mb-6 transition-instant transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] rounded"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to Books
      </Link>

      {isDeleted && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-body border"
          style={{
            background: "hsl(var(--warning)/0.1)",
            borderColor: "hsl(var(--warning)/0.3)",
            color: "hsl(var(--warning))",
          }}
          role="alert"
        >
          <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            This book was deleted on{" "}
            {book.deletedAt
              ? new Date(book.deletedAt).toLocaleDateString("en-US", {
                  dateStyle: "long",
                })
              : "an unknown date"}
            . It can be restored from the Trash view.
          </span>
        </div>
      )}

      <div className="flex gap-8 items-start">
        {/* Cover */}
        <div
          className="relative shrink-0 rounded-xl overflow-hidden elev-2"
          style={{ width: 180, height: 240 }}
          aria-hidden
        >
          {book.coverUrl ? (
            <Image
              src={book.coverUrl}
              alt={`Cover of ${book.title}`}
              fill
              sizes="180px"
              className="object-cover"
              priority
            />
          ) : (
            <div
              className="absolute inset-0 flex flex-col justify-end p-3"
              style={{ background: gradient }}
            >
              <p className="text-caption text-white/90 font-semibold line-clamp-4 leading-tight">
                {book.title}
              </p>
              {book.authors[0] && (
                <p className="text-caption text-white/60 mt-1 line-clamp-1">{book.authors[0]}</p>
              )}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="flex-1 min-w-0">
          <h1 className="text-h1 text-[hsl(var(--text-primary))] mb-1">{book.title}</h1>

          <p className="text-body text-[hsl(var(--text-secondary))] mb-3">
            {book.authors.join(", ")}
          </p>

          {/* Secondary metadata row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-[hsl(var(--text-secondary))] mb-4">
            {book.isbn13 && <span>{formatIsbn(book.isbn13)}</span>}
            {book.isbn13 && book.year && (
              <span className="text-[hsl(var(--text-tertiary))]">·</span>
            )}
            {book.year && <span>{book.year}</span>}
            {book.publisher && (
              <>
                <span className="text-[hsl(var(--text-tertiary))]">·</span>
                <span>{book.publisher}</span>
              </>
            )}
            {book.pageCount && (
              <>
                <span className="text-[hsl(var(--text-tertiary))]">·</span>
                <span>{book.pageCount} pages</span>
              </>
            )}
            {book.language && (
              <>
                <span className="text-[hsl(var(--text-tertiary))]">·</span>
                <span className="uppercase text-caption">{book.language}</span>
              </>
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 mb-5">
            {isDeleted ? (
              <Badge variant="warning">Deleted</Badge>
            ) : (
              <Badge variant="success">Available</Badge>
            )}
          </div>

          {/* Action buttons — CASL-gated */}
          <div className="flex items-center gap-2">
            {canUpdate && !isDeleted && (
              <Button variant="secondary" asChild>
                <Link href={`/books/${book.id}/edit`}>
                  <Edit className="h-4 w-4" aria-hidden />
                  Edit
                </Link>
              </Button>
            )}
            {/* Delete/Restore are client actions (need confirmation dialog) */}
            <BookActions
              book={{
                id: book.id,
                title: book.title,
                updatedAt: book.updatedAt.toISOString(),
                isDeleted,
              }}
              canDelete={canDelete}
            />
          </div>
        </div>
      </div>

      {/* Description */}
      {book.description && (
        <div className="mt-8 max-w-[720px]">
          <h2 className="text-h3 text-[hsl(var(--text-primary))] mb-3">About</h2>
          <p className="text-blurb text-[hsl(var(--text-secondary))]">{book.description}</p>
        </div>
      )}

      {/* Subjects */}
      {book.subjects && book.subjects.length > 0 && (
        <div className="mt-6">
          <h2 className="text-caption text-[hsl(var(--text-tertiary))] mb-2">Subjects</h2>
          <div className="flex flex-wrap gap-2">
            {book.subjects.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatIsbn(isbn13: string): string {
  // Format: 978-0-13-235088-4
  if (isbn13.length !== 13) return isbn13;
  return `${isbn13.slice(0, 3)}-${isbn13.slice(3, 4)}-${isbn13.slice(4, 6)}-${isbn13.slice(6, 12)}-${isbn13.slice(12)}`;
}
