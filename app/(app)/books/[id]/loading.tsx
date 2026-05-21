import { Skeleton } from "@/components/ui/skeleton";

export default function BookDetailLoading() {
  return (
    <div className="max-w-[960px] mx-auto">
      <div className="h-4 w-24 rounded mb-6 bg-[hsl(var(--bg-surface-2))] animate-pulse" />

      <div className="flex gap-8 items-start" aria-busy="true" aria-label="Loading book…">
        {/* Cover skeleton */}
        <div
          className="shrink-0 rounded-xl bg-[hsl(var(--bg-surface-2))] animate-pulse"
          style={{ width: 180, height: 240 }}
        />

        {/* Metadata skeleton */}
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <div className="flex gap-2 mt-4">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}
