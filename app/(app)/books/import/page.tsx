import { buildAbility } from "@/lib/auth/ability";
import { requireSession } from "@/lib/auth/session";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ImportWizard } from "./import-wizard";

export const metadata = {
  title: "Import Books — Stack",
  description: "Bulk catalog onboarding with batch enrichment from CSV spreadsheet uploads.",
};

/**
 * Import Books page — bulk CSV uploader.
 *
 * Access gate: requires book:create (librarian or tenant_admin).
 * Redirects unauthorized requests back to catalog.
 */
export default async function ImportBooksPage() {
  const session = await requireSession();
  const ability = buildAbility(session.roles);

  if (!ability.can("create", "Book")) {
    redirect("/books");
  }

  return (
    <div className="max-w-[800px] mx-auto space-y-6">
      {/* Navigation */}
      <div>
        <Link
          href="/books"
          className="inline-flex items-center gap-1.5 text-meta text-text-secondary hover:text-text-primary transition-quick"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Books
        </Link>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-h1 text-text-primary mb-1">Import Books</h1>
        <p className="text-body text-text-secondary">
          Onboard multiple books at once. We support standard RFC-4180 CSV files with automatic ISBN
          enrichment.
        </p>
      </div>

      {/* Main Form/Progress */}
      <ImportWizard />
    </div>
  );
}
