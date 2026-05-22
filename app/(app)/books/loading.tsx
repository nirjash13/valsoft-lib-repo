import { BookCardSkeleton } from "@/components/app/book-card";

/**
 * Books list loading skeleton — shown by Next.js Suspense while RSC renders.
 */
export default function BooksLoading() {
  return (
    <div className="max-w-[1200px] mx-auto">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <div className="h-8 w-32 rounded-md bg-surface-2 animate-pulse" />
          <div className="h-4 w-20 rounded bg-surface-2 animate-pulse" />
        </div>
        <div className="h-9 w-28 rounded-md bg-surface-2 animate-pulse" />
      </div>

      {/* Search skeleton */}
      <div className="mb-6">
        <div className="h-9 w-72 rounded-md bg-surface-2 animate-pulse" />
      </div>

      {/* Grid skeleton */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
        aria-busy="true"
        aria-label="Loading books…"
      >
        {Array.from({ length: 12 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
          <BookCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
