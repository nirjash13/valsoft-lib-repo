import { Button } from "@/components/ui/button";
import {
  type TenantCatalogConfig,
  requirePublicCatalog,
} from "@/lib/domain/catalog/resolve-tenant-by-slug";
import { Library } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function CatalogLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;

  let config: TenantCatalogConfig;
  try {
    config = await requirePublicCatalog(slug);
  } catch (_err) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-canvas text-text-primary flex flex-col">
      {/* Frosted glass header */}
      <header className="sticky top-0 z-50 glass-surface border-b border-border-subtle">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link
            href={`/${slug}/catalog`}
            className="flex items-center gap-2.5 group focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 rounded-md"
          >
            <Library className="h-6 w-6 text-accent group-hover:scale-105 transition-standard" />
            <span className="text-h3 font-semibold tracking-tight text-text-primary group-hover:text-accent transition-quick">
              {config.tenantName}
            </span>
          </Link>

          <Button asChild variant="default" size="sm">
            <Link href={`/signup?tenant=${slug}`}>Get a library card</Link>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-6 py-8">{children}</main>

      {/* Footer */}
      <footer className="border-t border-border-subtle py-8 mt-12 bg-surface">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-meta text-text-tertiary">
          <div>
            &copy; {new Date().getFullYear()} {config.tenantName}. All rights reserved.
          </div>
          <div className="flex items-center gap-1.5">
            <span>Powered by</span>
            <span className="font-semibold text-text-secondary">Stack Library</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
