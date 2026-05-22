import { ActiveFilterChips, FacetSidebar } from "@/components/search/facet-sidebar";
import { SearchBox } from "@/components/search/search-box";
import { SearchResults } from "@/components/search/search-results";
import { ZeroResults } from "@/components/search/zero-results";
import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { hybridSearch } from "@/lib/domain/search/hybrid-search";
import type { SearchInput } from "@/lib/domain/search/schemas";
import { notFound } from "next/navigation";

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    subjects?: string | string[];
    language?: string;
    availability?: string;
    yearFrom?: string;
    yearTo?: string;
    cursor?: string;
  }>;
}

/**
 * Hybrid search page — RSC shell.
 *
 * URL is the authoritative source of truth for all search state (per CLAUDE.md).
 * First paint calls hybridSearch directly (avoiding an extra HTTP round-trip).
 * The SearchBox client component uses router.replace to push ?q= updates so the
 * RSC re-renders with new results (search-as-you-type without a client fetch loop).
 *
 * Requires book:read (all authenticated roles).
 */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;

  const session = await requireSession();
  const ability = buildAbility(session.roles);

  if (!ability.can("read", "Book")) {
    notFound();
  }

  const tenantCtx = await sessionToTenantCtx(session);

  const rawQuery = params.q?.trim() ?? "";

  // Parse facet params from URL
  const activeSubjects: string[] = Array.isArray(params.subjects)
    ? params.subjects
    : params.subjects
      ? [params.subjects]
      : [];

  const activeLanguage = params.language?.trim() || undefined;

  const rawAvailability = params.availability;
  const activeAvailability: "in_stock" | "on_loan" | undefined =
    rawAvailability === "in_stock" || rawAvailability === "on_loan" ? rawAvailability : undefined;

  const rawYearFrom = params.yearFrom ? Number.parseInt(params.yearFrom, 10) : undefined;
  const rawYearTo = params.yearTo ? Number.parseInt(params.yearTo, 10) : undefined;
  const activeYearFrom =
    rawYearFrom !== undefined && Number.isFinite(rawYearFrom) ? rawYearFrom : undefined;
  const activeYearTo =
    rawYearTo !== undefined && Number.isFinite(rawYearTo) ? rawYearTo : undefined;

  // Empty state — no query
  if (!rawQuery) {
    return (
      <div className="max-w-[960px] mx-auto">
        <SearchPageHeader query="" />
        <SearchBox defaultValue="" />
        <EmptyPromptState />
      </div>
    );
  }

  // Build the search input (mirrors SearchInputSchema shape)
  const searchInput: SearchInput = {
    query: rawQuery,
    limit: 20,
    mode: "authenticated",
    cursor: params.cursor ?? undefined,
    filters: {
      subjects: activeSubjects.length > 0 ? activeSubjects : undefined,
      language: activeLanguage,
      availability: activeAvailability,
      yearFrom: activeYearFrom,
      yearTo: activeYearTo,
    },
  };

  const response = await withTenantTx(tenantCtx, (tx, ctx) => hybridSearch(tx, ctx, searchInput));

  // Build search href (base URL for "Load more" cursor construction)
  const currentParams = new URLSearchParams();
  currentParams.set("q", rawQuery);
  if (activeSubjects.length > 0) {
    for (const s of activeSubjects) currentParams.append("subjects", s);
  }
  if (activeLanguage) currentParams.set("language", activeLanguage);
  if (activeAvailability) currentParams.set("availability", activeAvailability);
  if (activeYearFrom !== undefined) currentParams.set("yearFrom", String(activeYearFrom));
  if (activeYearTo !== undefined) currentParams.set("yearTo", String(activeYearTo));
  const searchHref = `/search?${currentParams.toString()}`;

  const hasResults = response.results.length > 0;
  const hasActiveFacets =
    activeSubjects.length > 0 ||
    activeLanguage !== undefined ||
    activeAvailability !== undefined ||
    activeYearFrom !== undefined;

  return (
    <div className="max-w-[1200px] mx-auto">
      <SearchPageHeader query={rawQuery} />

      {/* Search box */}
      <div className="mb-6">
        <SearchBox defaultValue={rawQuery} />
      </div>

      {/* Active filter chips */}
      {hasActiveFacets && (
        <div className="mb-4">
          <ActiveFilterChips
            activeSubjects={activeSubjects}
            activeLanguage={activeLanguage}
            activeAvailability={activeAvailability}
            activeYearFrom={activeYearFrom}
            activeYearTo={activeYearTo}
          />
        </div>
      )}

      {/* Main layout: facet sidebar + results */}
      <div className="flex gap-8 items-start">
        {/* Facet sidebar — only shown when results exist */}
        {hasResults && (
          <FacetSidebar
            facets={response.facets}
            activeSubjects={activeSubjects}
            activeLanguage={activeLanguage}
            activeAvailability={activeAvailability}
            activeYearFrom={activeYearFrom}
            activeYearTo={activeYearTo}
          />
        )}

        {/* Results or zero state */}
        <div className="flex-1 min-w-0">
          {hasResults ? (
            <SearchResults
              results={response.results}
              cursor={response.cursor}
              totalCount={response.totalCount}
              searchHref={searchHref}
            />
          ) : (
            <ZeroResults query={rawQuery} />
          )}
        </div>
      </div>
    </div>
  );
}

function SearchPageHeader({ query }: { query: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-h1 text-text-primary">Search</h1>
      {query && (
        <p className="text-meta text-text-secondary mt-1">
          Results for <span className="text-text-primary">"{query}"</span>
        </p>
      )}
    </div>
  );
}

function EmptyPromptState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 text-3xl bg-surface-2"
        aria-hidden
      >
        🔎
      </div>
      <p className="text-h3 text-text-primary mb-2">Search the catalog</p>
      <p className="text-body text-text-secondary max-w-sm">
        Try a title, author name, or describe what you want — like "cozy mystery set in Iceland".
      </p>
    </div>
  );
}
