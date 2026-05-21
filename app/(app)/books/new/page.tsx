import { buildAbility } from "@/lib/auth/ability";
import { requireSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { NewBookForm } from "./new-book-form";

/**
 * New Book page — entry point for ISBN preview + manual entry.
 *
 * Access gate: requires book:create (librarian or tenant_admin).
 * Any visitor without the permission is redirected to /books.
 */
export default async function NewBookPage() {
  const session = await requireSession();
  const ability = buildAbility(session.roles);

  if (!ability.can("create", "Book")) {
    redirect("/books");
  }

  return (
    <div className="max-w-[720px] mx-auto">
      <h1 className="text-h1 text-[hsl(var(--text-primary))] mb-1">Add Book</h1>
      <p className="text-body text-[hsl(var(--text-secondary))] mb-8">
        Paste an ISBN to auto-fill, or type the fields directly.
      </p>
      <NewBookForm />
    </div>
  );
}
