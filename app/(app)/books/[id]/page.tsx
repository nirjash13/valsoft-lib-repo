import { PlaceHoldButton } from "@/components/circulation/place-hold-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import type { BookId } from "@/lib/db/schema/_shared";
import type { BookRow } from "@/lib/db/schema/books";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { BookNotFoundError } from "@/lib/domain/books/errors";
import { getBook } from "@/lib/domain/books/get-book";
import { listHoldsByBook } from "@/lib/domain/holds/list-holds-by-book";
import { hasActiveLoan } from "@/lib/domain/loans/has-active-loan";
import { getMemberByUserId } from "@/lib/domain/members/get-member-by-user-id";
import { booksLikeThis } from "@/lib/domain/search/books-like-this";
import { coverGradient } from "@/lib/utils/cover-color";
import { ArrowLeft, BookMarked, Edit, Trash2 } from "lucide-react";
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
  const canPlaceHold = ability.can("create", "Hold");
  const canReadHoldQueue = ability.can("read", "Hold");
  const gradient = coverGradient(book.title);
  const isDeleted = book.deletedAt !== null;

  // Circulation status + "Books like this" — only query when book is not deleted.
  const [isCheckedOut, holdQueue, currentMember, similarBooks] = isDeleted
    ? [false, [], null, [] as BookRow[]]
    : await withTenantTx(tenantCtx, async (tx) => {
        const [checkedOut, queue, member, similar] = await Promise.all([
          hasActiveLoan(tx, book.id),
          canReadHoldQueue ? listHoldsByBook(tx, tenantCtx, book.id) : Promise.resolve([]),
          canPlaceHold ? getMemberByUserId(tx, tenantCtx, session.sub) : Promise.resolve(null),
          booksLikeThis(tx, book.id as BookId),
        ]);
        return [checkedOut, queue, member, similar] as const;
      });

  return (
    <div className="max-w-[960px] mx-auto">
      {/* Back link */}
      <Link
        href="/books"
        className="inline-flex items-center gap-1.5 text-meta text-text-secondary hover:text-text-primary mb-6 transition-instant transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
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
          <h1 className="text-h1 text-text-primary mb-1">{book.title}</h1>

          <p className="text-body text-text-secondary mb-3">{book.authors.join(", ")}</p>

          {/* Secondary metadata row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-secondary mb-4">
            {book.isbn13 && <span>{formatIsbn(book.isbn13)}</span>}
            {book.isbn13 && book.year && <span className="text-text-tertiary">·</span>}
            {book.year && <span>{book.year}</span>}
            {book.publisher && (
              <>
                <span className="text-text-tertiary">·</span>
                <span>{book.publisher}</span>
              </>
            )}
            {book.pageCount && (
              <>
                <span className="text-text-tertiary">·</span>
                <span>{book.pageCount} pages</span>
              </>
            )}
            {book.language && (
              <>
                <span className="text-text-tertiary">·</span>
                <span className="uppercase text-caption">{book.language}</span>
              </>
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 mb-5">
            {isDeleted ? (
              <Badge variant="warning">Deleted</Badge>
            ) : isCheckedOut ? (
              <Badge variant="warning">Checked Out</Badge>
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
            {/* Place Hold — shown when book is checked out and user can place holds.
                Requires currentMember (auth0_user_id link, Spec 04). Until then,
                only shows to librarians/admins who have can('create','Hold')
                but member resolution returns null and button is suppressed. */}
            {canPlaceHold && isCheckedOut && !isDeleted && currentMember && (
              <PlaceHoldButton
                bookId={book.id}
                memberId={currentMember.id}
                bookTitle={book.title}
              />
            )}
            {canPlaceHold && isCheckedOut && !isDeleted && !currentMember && (
              <div className="flex items-center gap-1.5 text-meta text-text-secondary">
                <BookMarked className="h-4 w-4 shrink-0" aria-hidden />
                <span>Contact librarian to join hold queue</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {book.description && (
        <div className="mt-8 max-w-[720px]">
          <h2 className="text-h3 text-text-primary mb-3">About</h2>
          <p className="text-blurb text-text-secondary">{book.description}</p>
        </div>
      )}

      {/* Subjects */}
      {book.subjects && book.subjects.length > 0 && (
        <div className="mt-6">
          <h2 className="text-caption text-text-tertiary mb-2">Subjects</h2>
          <div className="flex flex-wrap gap-2">
            {book.subjects.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Hold queue — shown to librarians/admins when book is checked out */}
      {canReadHoldQueue && !isDeleted && holdQueue.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-h3 text-text-primary">Hold Queue</h2>
            <Link
              href={`/holds?bookId=${book.id}`}
              className="text-meta text-accent hover:underline underline-offset-2"
            >
              Manage queue
            </Link>
          </div>
          <ul
            className="rounded-xl border border-border-subtle overflow-hidden list-none m-0 p-0"
            aria-label="Hold queue"
          >
            {holdQueue.map((hold, index) => (
              <li
                key={hold.id}
                className="px-4 py-3 flex items-center justify-between gap-4 border-b border-border-subtle last:border-0 bg-surface"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-caption text-text-tertiary w-6 shrink-0">#{index + 1}</span>
                  <span className="text-body text-text-secondary font-mono text-caption truncate">
                    Member {hold.memberId.slice(0, 8)}…
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {hold.status === "ready" && <Badge variant="success">Ready</Badge>}
                  <span className="text-caption text-text-tertiary">
                    {formatDate(hold.queuedAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canReadHoldQueue && !isDeleted && holdQueue.length === 0 && isCheckedOut && (
        <div className="mt-8">
          <h2 className="text-h3 text-text-primary mb-2">Hold Queue</h2>
          <p className="text-meta text-text-secondary">No members are waiting for this book.</p>
        </div>
      )}

      {/* Books like this rail (Spec 05 REQ-05-05) — styled horizontal grid */}
      {similarBooks.length > 0 && !isDeleted && <BooksLikeThisRail books={similarBooks} />}
    </div>
  );
}

function formatIsbn(isbn13: string): string {
  // Format: 978-0-13-235088-4
  if (isbn13.length !== 13) return isbn13;
  return `${isbn13.slice(0, 3)}-${isbn13.slice(3, 4)}-${isbn13.slice(4, 6)}-${isbn13.slice(6, 12)}-${isbn13.slice(12)}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { dateStyle: "medium" });
}

// ---------------------------------------------------------------------------
// BooksLikeThisRail — styled horizontal grid (Spec 05 REQ-05-05, Run B polish)
// ---------------------------------------------------------------------------

function BooksLikeThisRail({ books }: { books: BookRow[] }) {
  return (
    <div className="mt-10">
      <h2 className="text-h3 text-text-primary mb-4">Books like this</h2>
      <ul
        className="grid gap-3 list-none m-0 p-0"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", maxWidth: 800 }}
        aria-label="Similar books"
      >
        {books.slice(0, 6).map((similar) => (
          <SimilarBookCard key={similar.id} book={similar} />
        ))}
      </ul>
    </div>
  );
}

function SimilarBookCard({ book }: { book: BookRow }) {
  const gradient = coverGradient(book.title);
  const primaryAuthor = book.authors[0] ?? "";

  return (
    <li>
      <Link
        href={`/books/${book.id}`}
        className="group flex flex-col rounded-xl overflow-hidden bg-surface border border-border-subtle elev-1 transition-standard transition-all hover:border-border-default hover:elev-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        {/* Cover — 3:4 */}
        <div className="relative w-full" style={{ aspectRatio: "3/4" }} aria-hidden>
          {book.coverUrl ? (
            <Image
              src={book.coverUrl}
              alt={`Cover of ${book.title}`}
              fill
              sizes="(max-width: 640px) 50vw, 140px"
              className="object-cover"
            />
          ) : (
            <div
              className="absolute inset-0 flex flex-col justify-end p-2"
              style={{ background: gradient }}
            >
              <p className="text-caption text-white/90 font-semibold line-clamp-3 leading-tight">
                {book.title}
              </p>
              {primaryAuthor && (
                <p className="text-[11px] text-white/60 mt-0.5 line-clamp-1 leading-tight">
                  {primaryAuthor}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="flex flex-col gap-0.5 p-2">
          <p className="text-meta font-semibold text-text-primary line-clamp-2 leading-snug group-hover:text-accent transition-instant transition-colors">
            {book.title}
          </p>
          {primaryAuthor && (
            <p className="text-[12px] text-text-secondary line-clamp-1">{primaryAuthor}</p>
          )}
        </div>
      </Link>
    </li>
  );
}
