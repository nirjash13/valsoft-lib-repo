import { Button } from "@/components/ui/button";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import {
  type TenantCatalogConfig,
  requirePublicCatalog,
} from "@/lib/domain/catalog/resolve-tenant-by-slug";
import type { PublicBookDetail } from "@/lib/domain/catalog/schemas";
import { getPublicBook } from "@/lib/domain/catalog/service";
import { coverGradient } from "@/lib/utils/cover-color";
import { ArrowLeft, BookOpen, Calendar, HelpCircle, Layers, Users } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

interface BookDetailPageProps {
  params: Promise<{ tenant: string; bookId: string }>;
}

export const revalidate = 60; // Cache this book detail page at the edge for 60 seconds (ISR)

/**
 * Per-book SEO metadata (REQ-09-04, NFR-09-04).
 * Renders server-side so crawlers see title/description without hydration.
 */
export async function generateMetadata({ params }: BookDetailPageProps): Promise<Metadata> {
  const { tenant: slug, bookId } = await params;

  let config: TenantCatalogConfig;
  try {
    config = await requirePublicCatalog(slug);
  } catch {
    return {};
  }

  let book: PublicBookDetail;
  try {
    book = await withSystemTenantTx(config.tenantId, (tx) =>
      getPublicBook(tx, bookId, config.publicCatalogSubjectBlocklist),
    );
  } catch {
    return {};
  }

  const title = `${book.title} — ${config.tenantName}`;
  const description = book.description
    ? book.description.slice(0, 160).trimEnd()
    : `${book.title} by ${book.authors.join(", ")} — available in the ${config.tenantName} catalog.`;

  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const canonical = `${baseUrl}/${slug}/catalog/${bookId}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      // Per-book OG image is served by app/(public)/[tenant]/catalog/[bookId]/opengraph-image.tsx
    },
  };
}

/**
 * Public catalog book detail page.
 *
 * Implements REQ-09-02, REQ-09-04, REQ-09-08 (login links).
 */
export default async function BookDetailPage({ params }: BookDetailPageProps) {
  const { tenant: slug, bookId } = await params;

  // 1. Resolve tenant & assert public catalog is enabled
  let config: TenantCatalogConfig;
  try {
    config = await requirePublicCatalog(slug);
  } catch (_err) {
    notFound();
  }

  // 2. Fetch single public book
  let book: PublicBookDetail;
  try {
    book = await withSystemTenantTx(config.tenantId, (tx) =>
      getPublicBook(tx, bookId, config.publicCatalogSubjectBlocklist),
    );
  } catch (_err) {
    notFound();
  }

  const gradient = coverGradient(book.title);
  const { status, dueAt, holdCount } = book.availability;
  const returnToPath = `/${slug}/catalog/${bookId}`;
  const loginUrl = `/auth/login?returnTo=${encodeURIComponent(returnToPath)}`;
  const signupUrl = `/signup?tenant=${slug}`;

  return (
    <div className="max-w-[1000px] mx-auto flex flex-col gap-6">
      {/* Back Link */}
      <div>
        <Link
          href={`/${slug}/catalog`}
          className="inline-flex items-center gap-2 text-meta text-text-secondary hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent rounded px-1.5 py-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to catalog
        </Link>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
        {/* Left Column: Cover & Action Card */}
        <div className="md:col-span-1 flex flex-col gap-6">
          {/* Cover Art */}
          <div
            className="relative w-full rounded-2xl overflow-hidden border border-border-subtle shadow-lg"
            style={{ aspectRatio: "3/4" }}
          >
            {book.coverUrl ? (
              <Image
                src={book.coverUrl}
                alt={`Cover art of ${book.title}`}
                fill
                sizes="(max-width: 768px) 100vw, 300px"
                className="object-cover"
                priority
              />
            ) : (
              <div
                className="absolute inset-0 flex flex-col justify-end p-6"
                style={{ background: gradient }}
              >
                <span className="text-h2 text-white/95 font-bold leading-tight line-clamp-4">
                  {book.title}
                </span>
                <span className="text-body text-white/70 mt-2 line-clamp-1">
                  {book.authors.join(", ")}
                </span>
              </div>
            )}
          </div>

          {/* Action & Availability Block (REQ-09-08 / REQ-09-02) */}
          <div className="bg-surface border border-border-subtle rounded-2xl p-6 flex flex-col gap-5 shadow-sm">
            <div>
              <h2 className="text-h3 text-text-primary mb-1">Availability</h2>
              {status === "available" ? (
                <div className="flex items-center gap-2 mt-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
                  <span className="text-body font-medium text-success">Available on shelf</span>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 mt-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-warning" />
                    <span className="text-body font-medium text-warning">Checked out</span>
                  </div>
                  {dueAt && (
                    <p className="text-[12px] text-text-secondary flex items-center gap-1.5 ml-4.5">
                      <Calendar className="h-3.5 w-3.5 text-text-tertiary" />
                      Due back{" "}
                      {new Date(dueAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  )}
                </div>
              )}

              {holdCount > 0 && (
                <p className="text-[12px] text-text-secondary flex items-center gap-1.5 mt-2 ml-4.5">
                  <Users className="h-3.5 w-3.5 text-text-tertiary" />
                  {holdCount} reader{holdCount > 1 ? "s" : ""} in line
                </p>
              )}
            </div>

            <div className="border-t border-border-subtle pt-4 flex flex-col gap-3">
              {status === "available" ? (
                <Button asChild className="w-full">
                  <Link href={loginUrl}>Sign in to Borrow</Link>
                </Button>
              ) : (
                <Button asChild variant="secondary" className="w-full">
                  <Link href={loginUrl}>Sign in to Place Hold</Link>
                </Button>
              )}

              <p className="text-caption text-text-tertiary text-center">
                Requires a member account.
              </p>
            </div>

            {/* Signup CTA banner */}
            <div className="border-t border-border-subtle pt-4 flex flex-col gap-2">
              <p className="text-[12px] text-text-secondary leading-normal">
                Not a library member yet? Apply online to start borrowing books.
              </p>
              <Link
                href={signupUrl}
                className="text-[13px] font-semibold text-accent hover:underline flex items-center gap-1 mt-1"
              >
                Request a library card &rarr;
              </Link>
            </div>
          </div>
        </div>

        {/* Right Column: Book Details */}
        <div className="md:col-span-2 flex flex-col gap-6">
          {/* Main Title Metadata */}
          <div>
            <h1 className="text-display text-text-primary tracking-tight leading-tight">
              {book.title}
            </h1>
            <p className="text-h2 text-text-secondary mt-2 font-medium">
              by {book.authors.join(", ")}
            </p>

            {/* Subject Chips */}
            {book.subjects && book.subjects.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4" aria-label="Book subjects">
                {book.subjects.map((subject) => (
                  <span
                    key={subject}
                    className="inline-flex items-center px-2.5 py-0.5 rounded-md text-meta font-medium bg-surface-2 text-text-secondary border border-border-subtle"
                  >
                    {subject}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          {book.description && (
            <div className="border-t border-border-subtle pt-6">
              <h2 className="text-h3 text-text-primary mb-3">About this book</h2>
              <div className="text-body text-text-secondary leading-relaxed whitespace-pre-line max-w-2xl">
                {book.description}
              </div>
            </div>
          )}

          {/* Detailed Info Table */}
          <div className="border-t border-border-subtle pt-6">
            <h2 className="text-h3 text-text-primary mb-4">Bibliographic details</h2>
            <div className="bg-surface border border-border-subtle rounded-2xl overflow-hidden shadow-sm">
              <dl className="divide-y divide-border-subtle m-0 p-0 text-body">
                {book.isbn13 && (
                  <div className="grid grid-cols-3 p-4 gap-4">
                    <dt className="font-medium text-text-secondary flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-text-tertiary" />
                      ISBN-13
                    </dt>
                    <dd className="col-span-2 text-text-primary font-mono" data-tabular>
                      {book.isbn13}
                    </dd>
                  </div>
                )}

                {book.publisher && (
                  <div className="grid grid-cols-3 p-4 gap-4">
                    <dt className="font-medium text-text-secondary flex items-center gap-2">
                      <Layers className="h-4 w-4 text-text-tertiary" />
                      Publisher
                    </dt>
                    <dd className="col-span-2 text-text-primary">{book.publisher}</dd>
                  </div>
                )}

                {book.year && (
                  <div className="grid grid-cols-3 p-4 gap-4">
                    <dt className="font-medium text-text-secondary flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-text-tertiary" />
                      Year Published
                    </dt>
                    <dd className="col-span-2 text-text-primary" data-tabular>
                      {book.year}
                    </dd>
                  </div>
                )}

                {book.pageCount && (
                  <div className="grid grid-cols-3 p-4 gap-4">
                    <dt className="font-medium text-text-secondary flex items-center gap-2">
                      <Layers className="h-4 w-4 text-text-tertiary" />
                      Page Count
                    </dt>
                    <dd className="col-span-2 text-text-primary" data-tabular>
                      {book.pageCount} pages
                    </dd>
                  </div>
                )}

                {book.language && (
                  <div className="grid grid-cols-3 p-4 gap-4">
                    <dt className="font-medium text-text-secondary flex items-center gap-2">
                      <HelpCircle className="h-4 w-4 text-text-tertiary" />
                      Language
                    </dt>
                    <dd className="col-span-2 text-text-primary uppercase">{book.language}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
