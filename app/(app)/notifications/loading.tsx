/**
 * Notifications loading skeleton — shown by Next.js while the RSC page renders.
 */
export default function NotificationsLoading() {
  return (
    <div className="space-y-8 max-w-4xl animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-elevated" />
        <div className="h-4 w-80 rounded bg-elevated" />
      </div>
      <div className="h-64 rounded-lg bg-elevated" />
      <div className="space-y-2">
        <div className="h-5 w-32 rounded bg-elevated" />
        <div className="h-40 rounded-md bg-elevated" />
      </div>
    </div>
  );
}
