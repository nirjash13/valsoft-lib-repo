/**
 * runRemindersForTenant — due-date reminder cron logic.
 *
 * Called once per tenant by the hourly cron route (app/api/cron/send-reminders).
 * Uses withSystemTenantTx for full RLS protection without an Auth0 session.
 *
 * SYSTEM-OWNER PATH — DO NOT IMPORT FROM TENANT-FACING CODE.
 *
 * Three time windows (all evaluated relative to now):
 *   due_soon  — loan.due_at in [now+46h, now+48h)
 *   due_today — loan.due_at in [now, now+2h)
 *   overdue   — loan.due_at in [now-26h, now-24h)
 *
 * H1/H2 — INVARIANT: NO network send runs inside a DB transaction.
 * Shape:
 *   1. ONE short tx to fetch candidate (loan, member, book) tuples for all windows.
 *   2. Loop OUTSIDE any transaction; per loan:
 *      a. Short tx: re-check returned_at IS NULL + not-soft-deleted.
 *         If removed, record skipped_subject_removed in that tx.
 *      b. Call sendDueReminder (manages its own short txs around the network call).
 *   3. Tally from sendDueReminder's discriminated return value (M2 fix).
 *
 * Idempotency: the notExists dedup filter in step 1 guards sequential re-runs.
 * For concurrent re-runs the partial unique index on (tenant_id, loan_id, email_type)
 * added in migration 0011 provides the authoritative guarantee — recordEmail for a
 * reminder catches and logs the unique-violation rather than crashing the cron.
 */

import { books } from "@/lib/db/schema/books";
import { loans } from "@/lib/db/schema/loans";
import { members } from "@/lib/db/schema/members";
import { outgoingEmails } from "@/lib/db/schema/outgoing-emails";
import { tenants } from "@/lib/db/schema/tenants";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import { and, eq, gte, isNull, lt, notExists } from "drizzle-orm";
import { recordEmail } from "./record-email";
import { type ReminderTick, type SendDueReminderResult, sendDueReminder } from "./send-lifecycle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RemindersResult {
  tenantId: string;
  sent: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

const HOURS = (h: number) => h * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Candidate row shape
// ---------------------------------------------------------------------------

interface CandidateRow {
  loanId: string;
  loanDueAt: Date;
  loanReturnedAt: Date | null;
  loanDeletedAt: Date | null;
  memberId: string;
  memberEmail: string;
  memberName: string;
  memberEmailStatus: "ok" | "bouncing" | "complained";
  memberLifecycleEnabled: boolean;
  memberDeletedAt: Date | null;
  bookTitle: string;
  bookDeletedAt: Date | null;
  tick: ReminderTick;
  emailType: "due_soon" | "due_today" | "overdue";
}

// ---------------------------------------------------------------------------
// runRemindersForTenant
// ---------------------------------------------------------------------------

/**
 * Runs all three reminder windows for one tenant and returns counts.
 *
 * Throws on unrecoverable errors — the caller (cron route) catches per-tenant.
 */
export async function runRemindersForTenant(tenantId: string): Promise<RemindersResult> {
  let sent = 0;
  let skipped = 0;

  const now = new Date();

  // ── Three time windows ───────────────────────────────────────────────────
  const windows: Array<{ tick: ReminderTick; from: Date; to: Date }> = [
    {
      tick: "T-2",
      from: new Date(now.getTime() + HOURS(46)),
      to: new Date(now.getTime() + HOURS(48)),
    },
    {
      tick: "T-0",
      from: now,
      to: new Date(now.getTime() + HOURS(2)),
    },
    {
      tick: "T+1",
      from: new Date(now.getTime() - HOURS(26)),
      to: new Date(now.getTime() - HOURS(24)),
    },
  ];

  // Step 1: ONE short tx — fetch all candidates across all windows + tenant name.
  const candidates: CandidateRow[] = [];
  let libraryName = "Stack Library";

  await withSystemTenantTx(tenantId, async (tx, _ctx) => {
    const [tenantRow] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    libraryName = tenantRow?.name ?? "Stack Library";

    for (const { tick, from, to } of windows) {
      const emailType = tick === "T-2" ? "due_soon" : tick === "T-0" ? "due_today" : "overdue";

      // notExists dedup — sequential re-runs are safe.
      const dedupSubquery = tx
        .select({ id: outgoingEmails.id })
        .from(outgoingEmails)
        .where(
          and(
            eq(outgoingEmails.tenantId, tenantId),
            eq(outgoingEmails.loanId, loans.id),
            eq(outgoingEmails.emailType, emailType),
          ),
        );

      const rows = await tx
        .select({
          loanId: loans.id,
          loanDueAt: loans.dueAt,
          loanReturnedAt: loans.returnedAt,
          loanDeletedAt: loans.deletedAt,
          memberId: members.id,
          memberEmail: members.email,
          memberName: members.displayName,
          memberEmailStatus: members.emailStatus,
          memberLifecycleEnabled: members.lifecycleEmailsEnabled,
          memberDeletedAt: members.deletedAt,
          bookTitle: books.title,
          bookDeletedAt: books.deletedAt,
        })
        .from(loans)
        .innerJoin(members, eq(loans.memberId, members.id))
        .innerJoin(books, eq(loans.bookId, books.id))
        .where(
          and(
            eq(loans.tenantId, tenantId),
            isNull(loans.returnedAt),
            isNull(loans.deletedAt),
            isNull(members.deletedAt),
            isNull(books.deletedAt),
            gte(loans.dueAt, from),
            lt(loans.dueAt, to),
            notExists(dedupSubquery),
          ),
        );

      for (const row of rows) {
        candidates.push({ ...row, tick, emailType });
      }
    }
  });

  // Step 2: loop OUTSIDE any transaction.
  for (const row of candidates) {
    // Edge case: re-check returned_at / deleted_at in a short tx (loan returned since query).
    const stillActive = await withSystemTenantTx(tenantId, async (tx, ctx) => {
      // Re-fetch the live state of loan, member, book.
      const [liveRow] = await tx
        .select({
          loanReturnedAt: loans.returnedAt,
          loanDeletedAt: loans.deletedAt,
          memberDeletedAt: members.deletedAt,
          bookDeletedAt: books.deletedAt,
        })
        .from(loans)
        .innerJoin(members, eq(loans.memberId, members.id))
        .innerJoin(books, eq(loans.bookId, books.id))
        .where(eq(loans.id, row.loanId));

      if (
        !liveRow ||
        liveRow.loanReturnedAt !== null ||
        liveRow.loanDeletedAt !== null ||
        liveRow.memberDeletedAt !== null ||
        liveRow.bookDeletedAt !== null
      ) {
        const subject =
          row.tick === "T-2"
            ? `Reminder: "${row.bookTitle}" is due in 2 days`
            : row.tick === "T-0"
              ? `"${row.bookTitle}" is due today`
              : `Overdue notice: "${row.bookTitle}"`;

        await recordEmail(tx, ctx, {
          memberId: row.memberId,
          loanId: row.loanId,
          toEmail: row.memberEmail,
          emailType: row.emailType,
          deliveryStatus: "skipped_subject_removed",
          subject,
        });
        return false;
      }

      return true;
    });

    if (!stillActive) {
      skipped++;
      continue;
    }

    const dueDate = row.loanDueAt.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

    // sendDueReminder handles opt-out + suppression + volume cap.
    // It manages its own short txs; NO transaction is open here.
    const result: SendDueReminderResult = await sendDueReminder({
      tenantId,
      loanId: row.loanId,
      member: {
        id: row.memberId,
        email: row.memberEmail,
        displayName: row.memberName,
        emailStatus: row.memberEmailStatus,
        lifecycleEmailsEnabled: row.memberLifecycleEnabled,
      },
      bookTitle: row.bookTitle,
      dueDate,
      libraryName,
      tick: row.tick,
    });

    // M2 fix: tally from the discriminated return value — single source of truth.
    if (result === "sent") {
      sent++;
    } else {
      skipped++;
    }
  }

  return { tenantId, sent, skipped };
}
