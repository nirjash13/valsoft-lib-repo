/**
 * Pending members loading skeleton.
 */

const SKELETON_KEYS = ["sk-0", "sk-1", "sk-2", "sk-3", "sk-4"] as const;

export default function PendingMembersLoading() {
  return (
    <div
      className="max-w-[900px] mx-auto"
      aria-busy="true"
      aria-label="Loading pending applications…"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <div className="h-8 w-56 rounded-md bg-surface-2 animate-pulse" />
          <div className="h-4 w-32 rounded bg-surface-2 animate-pulse" />
        </div>
      </div>
      <ul className="space-y-3 list-none p-0 m-0">
        {SKELETON_KEYS.map((key) => (
          <li
            key={key}
            className="rounded-xl border border-border-subtle bg-surface p-4 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-surface-2 animate-pulse shrink-0" />
              <div className="space-y-2">
                <div className="h-4 w-32 rounded bg-surface-2 animate-pulse" />
                <div className="h-3 w-44 rounded bg-surface-2 animate-pulse" />
                <div className="h-3 w-24 rounded bg-surface-2 animate-pulse" />
              </div>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <div className="h-8 w-24 rounded-md bg-surface-2 animate-pulse" />
              <div className="h-8 w-24 rounded-md bg-surface-2 animate-pulse" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
