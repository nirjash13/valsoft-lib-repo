/**
 * Loans list loading skeleton — shown by Next.js Suspense while RSC renders.
 */

const SKELETON_KEYS = ["sk-0", "sk-1", "sk-2", "sk-3", "sk-4", "sk-5", "sk-6", "sk-7"] as const;

export default function LoansLoading() {
  return (
    <div className="max-w-[1200px] mx-auto" aria-busy="true" aria-label="Loading loans…">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <div className="h-8 w-40 rounded-md bg-surface-2 animate-pulse" />
          <div className="h-4 w-24 rounded bg-surface-2 animate-pulse" />
        </div>
        <div className="h-6 w-32 rounded bg-surface-2 animate-pulse" />
      </div>

      {/* Row skeletons */}
      <div className="rounded-xl border border-border-subtle overflow-hidden">
        <ul className="list-none m-0 p-0">
          {SKELETON_KEYS.map((key) => (
            <li
              key={key}
              className="grid gap-4 px-4 py-3 border-b border-border-subtle last:border-0"
              style={{ gridTemplateColumns: "1fr 1fr auto auto auto" }}
            >
              <div className="h-4 w-24 rounded bg-surface-2 animate-pulse" />
              <div className="h-4 w-24 rounded bg-surface-2 animate-pulse" />
              <div className="h-4 w-20 rounded bg-surface-2 animate-pulse" />
              <div className="h-5 w-14 rounded-full bg-surface-2 animate-pulse" />
              <div className="h-7 w-16 rounded-md bg-surface-2 animate-pulse ml-auto" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
