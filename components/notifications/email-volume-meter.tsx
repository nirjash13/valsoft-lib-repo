/**
 * EmailVolumeMeter — compact month-to-date email send usage indicator.
 *
 * US-07: tenant admin sees per-tenant email volume.
 * NFR-07-03: default cap is 5,000/month; meter turns amber at ≥80%.
 */

interface EmailVolumeMeterProps {
  sentThisMonth: number;
  cap: number;
}

export function EmailVolumeMeter({ sentThisMonth, cap }: EmailVolumeMeterProps) {
  const pct = cap > 0 ? Math.min((sentThisMonth / cap) * 100, 100) : 0;
  const isNearCap = pct >= 80;

  const barColor = isNearCap ? "bg-amber-500" : "bg-accent";

  const textColor = isNearCap ? "text-amber-700 dark:text-amber-400" : "text-text-secondary";

  return (
    <div
      className="rounded-lg border border-border-subtle bg-surface p-4"
      aria-label="Monthly email volume"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-text-primary">Email volume this month</span>
        <span className={`text-sm font-medium tabular-nums ${textColor}`}>
          {sentThisMonth.toLocaleString()} / {cap.toLocaleString()}
          {isNearCap && (
            <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">
              — approaching cap
            </span>
          )}
        </span>
      </div>
      <div
        className="h-2 w-full rounded-full bg-border-subtle overflow-hidden"
        role="progressbar"
        tabIndex={0}
        aria-valuenow={sentThisMonth}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-label={`${sentThisMonth} of ${cap} emails sent this month`}
      >
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
