import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for the chat page while the RSC suspends.
 */
export default function ChatLoading() {
  return (
    <div className="flex flex-col h-full -m-6">
      {/* Header skeleton */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border-subtle bg-surface shrink-0">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Message area skeleton */}
      <div className="flex-1 overflow-hidden px-6 py-4">
        <div className="mx-auto max-w-2xl flex flex-col gap-4">
          <div className="flex justify-start">
            <Skeleton className="h-20 w-80 rounded-2xl" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-10 w-48 rounded-2xl" />
          </div>
          <div className="flex justify-start">
            <Skeleton className="h-28 w-96 rounded-2xl" />
          </div>
        </div>
      </div>

      {/* Input skeleton */}
      <div className="border-t border-border-subtle bg-surface px-6 py-3">
        <div className="mx-auto max-w-2xl">
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
