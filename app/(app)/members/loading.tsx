/**
 * Members list loading skeleton.
 */

const SKELETON_KEYS = ["sk-0", "sk-1", "sk-2", "sk-3", "sk-4", "sk-5"] as const;

export default function MembersLoading() {
  return (
    <div className="max-w-[1200px] mx-auto" aria-busy="true" aria-label="Loading members…">
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <div className="h-8 w-36 rounded-md bg-surface-2 animate-pulse" />
          <div className="h-4 w-24 rounded bg-surface-2 animate-pulse" />
        </div>
      </div>

      {/* Filter tab skeletons */}
      <div className="flex gap-2 mb-4">
        {(["a", "b", "c", "d", "e"] as const).map((k) => (
          <div key={k} className="h-6 w-16 rounded-full bg-surface-2 animate-pulse" />
        ))}
      </div>

      <div className="rounded-xl border border-border-subtle overflow-hidden">
        <ul className="list-none m-0 p-0">
          {SKELETON_KEYS.map((key) => (
            <li
              key={key}
              className="grid gap-4 px-4 py-3 border-b border-border-subtle last:border-0"
              style={{ gridTemplateColumns: "1.5fr 2fr 1fr 1fr 0.5fr 1fr" }}
            >
              <div className="h-4 w-28 rounded bg-surface-2 animate-pulse" />
              <div className="h-4 w-40 rounded bg-surface-2 animate-pulse" />
              <div className="h-5 w-16 rounded-full bg-surface-2 animate-pulse" />
              <div className="h-5 w-14 rounded-full bg-surface-2 animate-pulse" />
              <div className="h-4 w-8 rounded bg-surface-2 animate-pulse" />
              <div className="h-4 w-24 rounded bg-surface-2 animate-pulse" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
