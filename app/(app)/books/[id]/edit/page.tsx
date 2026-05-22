import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import type { BookRow } from "@/lib/db/schema/books";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { BookNotFoundError } from "@/lib/domain/books/errors";
import { getBook } from "@/lib/domain/books/get-book";
import { notFound, redirect } from "next/navigation";
import { EditBookForm } from "./edit-book-form";

interface EditBookPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Edit book page — RSC that loads the current book, gates on book:update,
 * then renders the client EditBookForm with the existing values pre-filled.
 */
export default async function EditBookPage({ params }: EditBookPageProps) {
  const { id } = await params;

  const session = await requireSession();
  const tenantCtx = await sessionToTenantCtx(session);
  const ability = buildAbility(session.roles);

  if (!ability.can("update", "Book")) {
    redirect("/books");
  }

  let book: BookRow;
  try {
    book = await withTenantTx(tenantCtx, (tx) => getBook(tx, id));
  } catch (err) {
    if (err instanceof BookNotFoundError) notFound();
    throw err;
  }

  // Soft-deleted books cannot be edited — redirect to detail page
  if (book.deletedAt !== null) {
    redirect(`/books/${id}`);
  }

  return (
    <div className="max-w-[720px] mx-auto">
      <h1 className="text-h1 text-text-primary mb-1">Edit Book</h1>
      <p className="text-body text-text-secondary mb-8 line-clamp-1">{book.title}</p>
      <EditBookForm
        book={{
          id: book.id,
          title: book.title,
          authors: book.authors,
          isbn13: book.isbn13 ?? undefined,
          year: book.year ?? undefined,
          publisher: book.publisher ?? undefined,
          pageCount: book.pageCount ?? undefined,
          subjects: book.subjects ?? undefined,
          language: book.language ?? undefined,
          coverUrl: book.coverUrl ?? undefined,
          description: book.description ?? undefined,
          updatedAt: book.updatedAt.toISOString(),
        }}
      />
    </div>
  );
}
