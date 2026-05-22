import { members } from "@/lib/db/schema/members";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import { sendEmail } from "@/lib/notifications/email-client";
import { EmailSendError } from "@/lib/notifications/errors";
import { interpolate } from "@/lib/notifications/interpolate";
import { markdownToHtml } from "@/lib/notifications/markdown-to-html";
import { signUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";
import { eq } from "drizzle-orm";
import { recordEmail } from "./record-email";
import { renderBatchReminder } from "./templates/render-email";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchRecipient {
  memberId: string;
  email: string;
  displayName: string;
  /** For {{book_title}} substitution. */
  bookTitle: string | null;
  /** For {{due_date}} substitution. */
  dueDate: string | null;
  /** For {{pickup_window}} substitution. */
  pickupWindow: string | null;
}

export interface SendBatchParams {
  tenantId: string;
  batchId: string;
  recipients: ReadonlyArray<BatchRecipient>;
  subject: string;
  bodyTemplate: string;
  /** Library name resolved by the action before calling sendBatch. */
  libraryName: string;
}

export interface SendBatchResult {
  sent: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// sendBatch
// ---------------------------------------------------------------------------

/**
 * Sends a batch email campaign to all recipients.
 * Called WITHOUT any enclosing transaction.
 *
 * Processes in chunks of 50. Per-recipient interpolation is applied to both
 * the subject and body before rendering the template.
 *
 * @param params Batch metadata, recipients, and template content.
 */
export async function sendBatch(params: SendBatchParams): Promise<SendBatchResult> {
  const {
    tenantId,
    batchId,
    recipients,
    subject: subjectTemplate,
    bodyTemplate,
    libraryName,
  } = params;

  const appUrl = process.env.APP_URL ?? "";

  let sent = 0;
  let failed = 0;

  // Process in chunks of 50.
  for (let offset = 0; offset < recipients.length; offset += CHUNK_SIZE) {
    const chunk = recipients.slice(offset, offset + CHUNK_SIZE);

    for (const recipient of chunk) {
      const vars: Record<string, string> = {
        name: recipient.displayName,
        ...(recipient.bookTitle !== null ? { book_title: recipient.bookTitle } : {}),
        ...(recipient.dueDate !== null ? { due_date: recipient.dueDate } : {}),
        ...(recipient.pickupWindow !== null ? { pickup_window: recipient.pickupWindow } : {}),
      };

      const interpolatedSubject = interpolate(subjectTemplate, vars);

      // Step 1: short tx — re-fetch live emailStatus + suppression check.
      const suppressed = await withSystemTenantTx(tenantId, async (tx, ctx) => {
        const [memberRow] = await tx
          .select({ emailStatus: members.emailStatus })
          .from(members)
          .where(eq(members.id, recipient.memberId));

        // Suppression: covers bouncing + complained (REQ-07-08, M3 fix).
        if (memberRow?.emailStatus !== "ok") {
          await recordEmail(tx, ctx, {
            memberId: recipient.memberId,
            batchId,
            toEmail: recipient.email,
            emailType: "batch_reminder",
            deliveryStatus: "failed",
            subject: interpolatedSubject,
            error: "Recipient suppressed: bouncing or complained",
          });
          return true;
        }
        return false;
      });

      if (suppressed) {
        failed++;
        continue;
      }

      // Step 2: render + send — NO transaction open. Per-recipient try/catch.
      const interpolatedBody = interpolate(bodyTemplate, vars);
      // Convert the interpolated Markdown body to sanitized HTML before passing
      // to the template, which renders it via dangerouslySetInnerHTML (REQ-07-07).
      const bodyHtml = markdownToHtml(interpolatedBody);
      const token = signUnsubscribeToken(recipient.memberId);
      const unsubscribeUrl = `${appUrl}/unsubscribe?token=${token}`;

      let html: string;
      try {
        html = await renderBatchReminder({
          subjectLine: interpolatedSubject,
          bodyHtml,
          libraryName,
          unsubscribeUrl,
        });
      } catch (renderErr) {
        // Render failures are non-retryable; record failed row.
        console.error(
          `[send-batch] render failed for member=${recipient.memberId} batch=${batchId}:`,
          renderErr,
        );
        await withSystemTenantTx(tenantId, async (tx, ctx) => {
          await recordEmail(tx, ctx, {
            memberId: recipient.memberId,
            batchId,
            toEmail: recipient.email,
            emailType: "batch_reminder",
            deliveryStatus: "failed",
            subject: interpolatedSubject,
            error: "render failed",
          });
        });
        failed++;
        continue;
      }

      const sentAt = new Date();

      try {
        const sendResult = await sendEmail({
          to: recipient.email,
          subject: interpolatedSubject,
          html,
        });

        // Step 3: short tx — record the audit row.
        await withSystemTenantTx(tenantId, async (tx, ctx) => {
          await recordEmail(tx, ctx, {
            memberId: recipient.memberId,
            batchId,
            toEmail: recipient.email,
            emailType: "batch_reminder",
            deliveryStatus: "queued",
            subject: interpolatedSubject,
            resendId: sendResult.id,
            sentAt,
          });
        });

        sent++;
      } catch (err) {
        // M5 fix: sanitize the error string — never persist raw error detail.
        const sanitized =
          err instanceof EmailSendError ? `Resend error ${err.statusCode ?? ""}` : "send failed";

        console.error(
          `[send-batch] send failed for member=${recipient.memberId} batch=${batchId}:`,
          err,
        );

        // Step 3 (failure branch): short tx — record the failed audit row.
        await withSystemTenantTx(tenantId, async (tx, ctx) => {
          await recordEmail(tx, ctx, {
            memberId: recipient.memberId,
            batchId,
            toEmail: recipient.email,
            emailType: "batch_reminder",
            deliveryStatus: "failed",
            subject: interpolatedSubject,
            error: sanitized,
            sentAt,
          });
        });

        failed++;
      }
    }
  }

  return { sent, failed };
}
