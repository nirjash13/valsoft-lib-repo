/**
 * BounceBanner — REQ-07-08 acceptance scenario.
 *
 * Renders a dismissible warning when one or more tenant members have a
 * permanently bouncing email address that needs updating.
 *
 * WCAG 2.2 AA: uses role="alert" so the banner is announced by screen readers
 * immediately on render.
 */

interface BounceBannerProps {
  bouncingCount: number;
}

export function BounceBanner({ bouncingCount }: BounceBannerProps) {
  if (bouncingCount === 0) return null;

  const memberLabel = bouncingCount === 1 ? "member has" : "members have";

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-300"
    >
      <svg
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
      <p className="text-sm font-medium">
        {bouncingCount} {memberLabel} a bouncing email address — needs update.
      </p>
    </div>
  );
}
