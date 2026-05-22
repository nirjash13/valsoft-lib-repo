/**
 * Holds list loading skeleton — shown by Next.js Suspense while RSC renders.
 */

const SKELETON_KEYS = ["sk-0", "sk-1", "sk-2", "sk-3"] as const;

export default function HoldsLoading() {
  return (
    <div className="max-w-[800px] mx-auto" aria-busy="true" aria-label="Loading holds…">
      {/* Header skeleton */}
      <div className="space-y-2 mb-6">
        <div className="h-8 w-36 rounded-md bg-surface-2 animate-pulse" />
        <div className="h-4 w-24 rounded bg-surface-2 animate-pulse" />
      </div>

      {/* Card skeletons */}
      <ul className="space-y-3 list-none p-0 m-0">
        {SKELETON_KEYS.map((key) => (
          <li
            key={key}
            className="rounded-xl border border-border-subtle bg-surface p-4 flex items-center justify-between gap-4"
          >
            <div className="space-y-2 flex-1">
              <div className="h-5 w-48 rounded bg-surface-2 animate-pulse" />
              <div className="h-4 w-32 rounded bg-surface-2 animate-pulse" />
            </div>
            <div className="h-7 w-24 rounded-md bg-surface-2 animate-pulse" />
          </li>
        ))}
      </ul>
    </div>
  );
}
