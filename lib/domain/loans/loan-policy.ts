/**
 * Pure loan policy helpers — no DB, no Next imports.
 * Extracted for unit testability.
 */

/**
 * Computes the due date for a new loan.
 *
 * @param checkedOutAt   - Borrow timestamp (typically NOW() from DB).
 * @param loanDurationDays - Tenant policy: how many calendar days until due.
 * @returns The due date as a Date (UTC, no rounding).
 */
export function computeDueAt(checkedOutAt: Date, loanDurationDays: number): Date {
  const due = new Date(checkedOutAt);
  due.setUTCDate(due.getUTCDate() + loanDurationDays);
  return due;
}

/**
 * Determines whether a loan is eligible for renewal.
 *
 * @param renewedCount   - How many times this loan has already been renewed.
 * @param maxRenewals    - Tenant policy maximum.
 * @param hasQueuedHold  - Whether any queued/ready hold exists for this book.
 */
export function canRenew({
  renewedCount,
  maxRenewals,
  hasQueuedHold,
}: {
  renewedCount: number;
  maxRenewals: number;
  hasQueuedHold: boolean;
}): boolean {
  return renewedCount < maxRenewals && !hasQueuedHold;
}
