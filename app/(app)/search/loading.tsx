/**
 * Search page loading skeleton.
 * Shown by Next.js during RSC streaming while the search query runs.
 * Uses const key array (not array index) to satisfy biome noArrayIndexKey.
 */

const RESULT_SKELETON_KEYS = [
  "sk-result-1",
  "sk-result-2",
  "sk-result-3",
  "sk-result-4",
  "sk-result-5",
  "sk-result-6",
] as const;

const FACET_SKELETON_KEYS = [
  "sk-facet-1",
  "sk-facet-2",
  "sk-facet-3",
  "sk-facet-4",
  "sk-facet-5",
] as const;

export default function SearchLoading() {
  return (
    <div className="max-w-[1200px] mx-auto" aria-busy="true" aria-label="Loading search results">
      {/* Header skeleton */}
      <div className="mb-6">
        <div className="h-8 w-28 rounded-lg bg-surface-2 animate-pulse mb-2" />
        <div className="h-4 w-48 rounded bg-surface-2 animate-pulse" />
      </div>

      {/* Search input skeleton */}
      <div className="mb-6">
        <div className="h-10 w-full rounded-lg bg-surface-2 animate-pulse" />
      </div>

      {/* Main layout skeleton */}
      <div className="flex gap-8 items-start">
        {/* Facet sidebar skeleton */}
        <aside className="w-56 shrink-0 flex flex-col gap-5">
          <div>
            <div className="h-3 w-16 rounded bg-surface-2 animate-pulse mb-3" />
            <div className="flex flex-col gap-2">
              {FACET_SKELETON_KEYS.map((key) => (
                <div key={key} className="h-7 rounded-md bg-surface-2 animate-pulse" />
              ))}
            </div>
          </div>
        </aside>

        {/* Results skeleton */}
        <div className="flex-1 min-w-0">
          <div className="h-4 w-24 rounded bg-surface-2 animate-pulse mb-4" />
          <ul className="flex flex-col divide-y divide-border-subtle list-none m-0 p-0 rounded-xl border border-border-subtle overflow-hidden">
            {RESULT_SKELETON_KEYS.map((key) => (
              <li key={key} className="flex gap-4 px-4 py-3 bg-surface">
                {/* Mini cover */}
                <div
                  className="shrink-0 rounded-md bg-surface-2 animate-pulse"
                  style={{ width: 48, height: 64 }}
                />
                {/* Text lines */}
                <div className="flex-1 flex flex-col justify-center gap-2">
                  <div className="h-4 w-3/4 rounded bg-surface-2 animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-surface-2 animate-pulse" />
                  <div className="h-3 w-full rounded bg-surface-2 animate-pulse" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
