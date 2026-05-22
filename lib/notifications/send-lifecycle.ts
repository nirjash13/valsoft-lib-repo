/**
 * Lifecycle email sender — due-date reminders (REQ-07-01).
 *
 * sendDueReminder handles three ticks:
 *   T-2 → due_soon  (loan due in ~48h)
 *   T-0 → due_today (loan due within ~2h)
 *   T+1 → overdue   (loan overdue by ~24-26h)
 *
 * Opt-out (REQ-07-09): if member.lifecycleEmailsEnabled is false, record
 * a skipped_opt_out row and return "skipped_opt_out".
 *
 * Bounce/complaint suppression (REQ-07-08): if member.emailStatus is not 'ok'
 * (covers both 'bouncing' and 'complained'), record a failed row and return
 * "skipped_bouncing".
 *
 * Lifecycle emails include an unsubscribeUrl (US-08).
 *
 * H1/H2 — INVARIANT: NO network send runs inside a DB transaction.
 * The function manages its own short transactions:
 *   1. Short tx: check opt-out + suppression + assertEmailVolume.
 *      If skipped/capped, record the row in that tx and return early.
 *   2. Render + sendEmail with NO transaction open.
 *   3. Short tx: recordEmail with the resendId.
 *
 * Returns a discriminated result so callers can tally from a single source of
 * truth (M2 fix).
 */

import type { Member } from "@/lib/db/schema/members";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import { sendEmail } from "@/lib/notifications/email-client";
import { signUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";
import { recordEmail } from "./record-email";
import { renderDueReminder } from "./templates/render-email";
import { assertEmailVolume } from "./volume-cap";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReminderTick = "T-2" | "T-0" | "T+1";

const TICK_TO_EMAIL_TYPE = {
  "T-2": "due_soon",
  "T-0": "due_today",
  "T+1": "overdue",
} as const satisfies Record<ReminderTick, "due_soon" | "due_today" | "overdue">;

/** Discriminated result returned by sendDueReminder (M2 fix). */
export type SendDueReminderResult =
  | "sent"
  | "skipped_opt_out"
  | "skipped_bouncing"
  | "skipped_subject_removed";

export interface SendDueReminderParams {
  tenantId: string;
  loanId: string;
  member: Pick<Member, "id" | "email" | "displayName" | "emailStatus" | "lifecycleEmailsEnabled">;
  bookTitle: string;
  /** Formatted due date string, e.g. "June 3, 2026". */
  dueDate: string;
  /** The library name (pre-fetched by the caller). */
  libraryName: string;
  tick: ReminderTick;
}

// ---------------------------------------------------------------------------
// sendDueReminder
// ---------------------------------------------------------------------------

/**
 * Sends a due-date reminder lifecycle email (or records a skip/failure).
 * Returns a discriminated result for caller-side tallying.
 * NO enclosing transaction may be open when this is called.
 *
 * @param params Tenant, loan, member, tick, and book info.
 */
export async function sendDueReminder(
  params: SendDueReminderParams,
): Promise<SendDueReminderResult> {
  const { tenantId, loanId, member, bookTitle, dueDate, libraryName, tick } = params;
  const emailType = TICK_TO_EMAIL_TYPE[tick];

  const tickSubject: Record<ReminderTick, string> = {
    "T-2": `Reminder: "${bookTitle}" is due in 2 days`,
    "T-0": `"${bookTitle}" is due today`,
    "T+1": `Overdue notice: "${bookTitle}" was due ${dueDate}`,
  };
  const subject = tickSubject[tick];

  // Step 1: short tx — opt-out + suppression + volume cap checks.
  type LoadResult =
    | { proceed: false; result: SendDueReminderResult }
    | { proceed: true; subject: string; unsubscribeUrl: string };

  const loaded = await withSystemTenantTx<LoadResult>(tenantId, async (tx, ctx) => {
    // Opt-out check (REQ-07-09).
    if (!member.lifecycleEmailsEnabled) {
      await recordEmail(tx, ctx, {
        memberId: member.id,
        loanId,
        toEmail: member.email,
        emailType,
        deliveryStatus: "skipped_opt_out",
        subject,
      });
      return { proceed: false, result: "skipped_opt_out" };
    }

    // Suppression: covers bouncing + complained (REQ-07-08, M3 fix).
    if (member.emailStatus !== "ok") {
      await recordEmail(tx, ctx, {
        memberId: member.id,
        loanId,
        toEmail: member.email,
        emailType,
        deliveryStatus: "failed",
        subject,
        error: "Recipient suppressed: bouncing or complained",
      });
      return { proceed: false, result: "skipped_bouncing" };
    }

    await assertEmailVolume(tx, ctx);

    const token = signUnsubscribeToken(member.id);
    const appUrl = process.env.APP_URL ?? "";
    const unsubscribeUrl = `${appUrl}/unsubscribe?token=${token}`;

    return { proceed: true, subject, unsubscribeUrl };
  });

  if (!loaded.proceed) return loaded.result;

  // Step 2: render + send — NO transaction open.
  const html = await renderDueReminder({
    tick,
    memberName: member.displayName,
    bookTitle,
    dueDate,
    libraryName,
    unsubscribeUrl: loaded.unsubscribeUrl,
  });

  const sentAt = new Date();
  const sendResult = await sendEmail({ to: member.email, subject: loaded.subject, html });

  // Step 3: short tx — record the audit row.
  // If a concurrent run already recorded for this (loan_id, email_type) the
  // partial-unique constraint (migration 0011) will throw — catch it and continue.
  try {
    await withSystemTenantTx(tenantId, async (tx, ctx) => {
      await recordEmail(tx, ctx, {
        memberId: member.id,
        loanId,
        toEmail: member.email,
        emailType,
        deliveryStatus: "queued",
        subject: loaded.subject,
        resendId: sendResult.id,
        sentAt,
      });
    });
  } catch (dedupErr) {
    // Tolerate ONLY a Postgres unique-violation (SQLSTATE 23505) on
    // (tenant_id, loan_id, email_type) — a concurrent run already recorded this
    // reminder (migration 0011 partial index). Any other error (transient DB
    // failure, connection loss) must propagate, not be silently swallowed.
    const code =
      typeof dedupErr === "object" && dedupErr !== null && "code" in dedupErr
        ? (dedupErr as { code?: unknown }).code
        : undefined;
    if (code !== "23505") throw dedupErr;
    console.error(
      `[send-lifecycle] dedup conflict for loan=${loanId} tick=${tick} — concurrent run already recorded`,
    );
  }

  return "sent";
}
