import { sql } from "drizzle-orm";
import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { type Branded, createdAt, tenantIdColumn, updatedAt } from "./_shared";
import { emailBatches } from "./email-batches";
import { loans } from "./loans";
import { members } from "./members";
import { tenants } from "./tenants";

export type OutgoingEmailId = Branded<string, "OutgoingEmailId">;

/**
 * outgoing_email_type — what triggered this email.
 *
 * due_soon:        T-2 days lifecycle reminder (REQ-07-01).
 * due_today:       T-0 lifecycle reminder (REQ-07-01).
 * overdue:         T+1 overdue notice (REQ-07-01).
 * hold_ready:      hold promoted, patron can collect (REQ-07-02).
 * welcome:         member signup approved (REQ-07-03).
 * rejection:       member signup rejected (REQ-07-04).
 * batch_reminder:  librarian-composed batch campaign (REQ-07-05).
 */
export const outgoingEmailTypeEnum = pgEnum("outgoing_email_type", [
  "due_soon",
  "due_today",
  "overdue",
  "hold_ready",
  "welcome",
  "rejection",
  "batch_reminder",
]);

/**
 * email_delivery_status — end-to-end state of a single email send attempt.
 *
 * queued:               row written; not yet dispatched to Resend.
 * sent:                 dispatched to Resend; awaiting webhook confirmation.
 * delivered:            Resend webhook confirmed delivery.
 * bounced:              permanent or temporary bounce received.
 * complained:           spam complaint received.
 * failed:               send attempt failed (non-bounce error).
 * skipped_opt_out:      member has lifecycle_emails_enabled=false (REQ-07-09).
 * skipped_subject_removed: loan/hold/member soft-deleted before send (edge case §7).
 */
export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", [
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "skipped_opt_out",
  "skipped_subject_removed",
]);

/**
 * outgoing_emails — one row per email send attempt.
 *
 * Multi-tenancy: tenant_id set from verified JWT org via withTenantTx.
 * RLS ENABLE + FORCE + tenant_isolation policy enforced by migration 0010.
 *
 * batch_id:  set for batch_reminder emails; null for transactional/lifecycle.
 *            ON DELETE SET NULL so deleting a batch row does not cascade-delete the audit trail.
 * member_id: nullable — welcome/rejection emails reference a member that may not exist
 *            as a member row yet (pre-approval state).
 * loan_id:   nullable — only set for due_soon / due_today / overdue.
 * resend_id: Resend message ID returned on send; used to correlate webhook callbacks.
 * error:     raw error message or HTTP status from Resend on failure; null on success.
 * sent_at:   timestamp when the send request was dispatched; null until dispatched.
 */
export const outgoingEmails = pgTable(
  "outgoing_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn().references(() => tenants.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id").references(() => emailBatches.id, { onDelete: "set null" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    loanId: uuid("loan_id").references(() => loans.id, { onDelete: "set null" }),
    toEmail: text("to_email").notNull(),
    emailType: outgoingEmailTypeEnum("email_type").notNull(),
    deliveryStatus: emailDeliveryStatusEnum("delivery_status").notNull(),
    subject: text("subject").notNull(),
    resendId: text("resend_id"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    sentAt: timestamp("sent_at", { withTimezone: true, precision: 3 }),
  },
  (t) => [
    /**
     * M1 fix: partial unique index — reminder dedup authoritative at the DB level.
     * Covers due_soon / due_today / overdue rows (loan_id IS NOT NULL).
     * batch_reminder / transactional rows have loan_id NULL and are excluded.
     */
    uniqueIndex("outgoing_emails_reminder_dedup_idx")
      .on(t.tenantId, t.loanId, t.emailType)
      .where(sql`${t.loanId} IS NOT NULL`),
  ],
);

export type OutgoingEmailRow = typeof outgoingEmails.$inferSelect;
export type NewOutgoingEmailRow = typeof outgoingEmails.$inferInsert;
