/**
 * Notifications Server Actions — compose-batch email commands.
 *
 * Two actions:
 *   draftBatchEmailAction — AI-drafts a patron email for a given audience filter.
 *   sendBatchEmailAction  — confirms and dispatches the batch to live recipients.
 *
 * REQ-07-05 / REQ-07-07 / US-04 / US-05 / US-07.
 *
 * Pattern: actionClient.schema(…).metadata({ permission }).action(async ({ parsedInput, ctx }) =>
 *   withTenantTx(ctx.tenantCtx, async (tx, txCtx) => …)
 * )
 *
 * H1/H2 fix for sendBatchEmailAction:
 *   1. Short withTenantTx: re-fetch recipients + insert email_batches row +
 *      assertEmailVolume once up front. No network call inside the tx.
 *   2. Call sendBatch OUTSIDE that transaction (it manages its own short txs per-recipient).
 *   3. Short withTenantTx: update the batch status + set updatedAt.
 */

"use server";

import { actionClient } from "@/lib/auth/safe-action";
import type { TenantId } from "@/lib/db/schema/_shared";
import { emailBatches } from "@/lib/db/schema/email-batches";
import { tenants } from "@/lib/db/schema/tenants";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { getMemberByUserId } from "@/lib/domain/members/get-member-by-user-id";
import { getAudiencePreview } from "@/lib/domain/notifications/audience";
import { draftPatronEmail } from "@/lib/notifications/ai-draft";
import { DraftBatchEmailSchema, SendBatchEmailSchema } from "@/lib/notifications/schemas";
import { sendBatch } from "@/lib/notifications/send-batch";
import { assertEmailVolume } from "@/lib/notifications/volume-cap";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";

// ---------------------------------------------------------------------------
// draftBatchEmailAction — email:compose
// ---------------------------------------------------------------------------

/**
 * Drafts a batch patron email using the AI model.
 *
 * 1. Loads the audience preview for the given filter.
 * 2. Builds a PII-FREE audience summary (count + filter label + DISTINCT book
 *    titles only — NEVER member names or email addresses; NFR-07-05).
 * 3. Reads the tenant brand voice.
 * 4. Calls draftPatronEmail (AI gateway call; assertAiBudget inside).
 * 5. Returns the structured draft + recipient count.
 *
 * Read-only: no mutations, no cache invalidation.
 *
 * @permission email:compose
 */
export const draftBatchEmailAction = actionClient
  .schema(DraftBatchEmailSchema)
  .metadata({ permission: "email:compose" })
  .action(async ({ parsedInput, ctx }) => {
    const { audienceFilter, intent } = parsedInput;

    const { audienceSummary, recipientCount, brandVoice } = await withTenantTx(
      ctx.tenantCtx,
      async (tx, txCtx) => {
        const recipients = await getAudiencePreview(tx, txCtx, audienceFilter);

        // Resolve brand voice from tenant row.
        const [tenantRow] = await tx
          .select({ brandVoice: tenants.brandVoice })
          .from(tenants)
          .where(eq(tenants.id, txCtx.tenantId));
        const resolvedBrandVoice = tenantRow?.brandVoice ?? null;

        // NFR-07-05: audienceSummary MUST contain ZERO per-recipient PII.
        // Allowed: count, filter label, DISTINCT book titles only.
        // NEVER include member names, email addresses, or member IDs.
        const distinctTitles = Array.from(
          new Set(recipients.map((r) => r.bookTitle).filter((t): t is string => t !== null)),
        ).slice(0, 10); // cap at 10 titles to stay within token budget

        const filterLabels: Record<string, string> = {
          overdue_7d: "books overdue 7+ days",
          overdue_5d: "books overdue 5+ days",
          due_this_week: "books due this week",
          holds_ready: "holds ready for pickup",
        };
        const filterLabel = filterLabels[audienceFilter] ?? audienceFilter;

        // Build the PII-free summary for the LLM prompt.
        const titlesPart =
          distinctTitles.length > 0 ? ` Sample titles: ${distinctTitles.join(", ")}.` : "";
        const summary = `${recipients.length} patron(s) with ${filterLabel}.${titlesPart}`;

        return {
          brandVoice: resolvedBrandVoice,
          audienceSummary: summary,
          recipientCount: recipients.length,
        };
      },
    );

    // AI draft call is outside withTenantTx — it is an HTTP call to the AI gateway,
    // not a DB mutation, and must not hold a DB connection open during inference.
    const draft = await draftPatronEmail({
      tenantId: ctx.tenantCtx.tenantId as TenantId,
      intent,
      audienceSummary,
      brandVoice,
    });

    return { draft, recipientCount };
  });

// ---------------------------------------------------------------------------
// sendBatchEmailAction — email:send
// ---------------------------------------------------------------------------

/**
 * Confirms and dispatches a batch patron email campaign.
 *
 * 1. Short tx: re-fetch audience + resolve caller member + assertEmailVolume +
 *    insert email_batches row. No network call inside this tx.
 * 2. Call sendBatch OUTSIDE any transaction (it manages its own short txs).
 * 3. Short tx: update batch status + updatedAt based on result counts.
 * 4. After commit: invalidate the emails cache tag for the tenant.
 *
 * @permission email:send
 */
export const sendBatchEmailAction = actionClient
  .schema(SendBatchEmailSchema)
  .metadata({ permission: "email:send" })
  .action(async ({ parsedInput, ctx }) => {
    const { audienceFilter, subject, bodyMarkdown, aiDrafted, draftedRecipientCount } = parsedInput;
    const tenantId = ctx.tenantCtx.tenantId;

    // Step 1: short tx — setup only, no network calls.
    const step1 = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      // Re-fetch audience — the window may have shifted since the draft step.
      const audienceRecipients = await getAudiencePreview(tx, txCtx, audienceFilter);

      // §7 edge case: if the audience changed since the draft was generated,
      // return early with a typed signal so the UI can warn the librarian.
      // Only compare when draftedRecipientCount is provided (i.e. an AI draft was taken).
      if (draftedRecipientCount !== null && audienceRecipients.length !== draftedRecipientCount) {
        return {
          audienceChanged: true as const,
          sendTimeCount: audienceRecipients.length,
        };
      }

      // Resolve the caller's member UUID for the createdBy FK.
      const callerMember = await getMemberByUserId(tx, txCtx, ctx.session.sub);
      if (!callerMember) {
        throw new Error("Caller has no linked member row in this tenant");
      }

      // Volume cap check — once up front, before any sends.
      await assertEmailVolume(tx, txCtx);

      // Resolve library name for the send step.
      const [tenantRow] = await tx
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, txCtx.tenantId));
      const resolvedLibraryName = tenantRow?.name ?? "Stack Library";

      // Insert the email_batches record.
      const [batchRow] = await tx
        .insert(emailBatches)
        .values({
          tenantId: txCtx.tenantId,
          createdBy: callerMember.id,
          audienceFilter,
          subject,
          bodyMarkdown,
          recipientCount: audienceRecipients.length,
          aiDrafted,
          status: "sent", // will be updated after sendBatch
        })
        .returning({ id: emailBatches.id });

      if (!batchRow) {
        throw new Error("Failed to insert email_batches row");
      }

      return {
        audienceChanged: false as const,
        batchId: batchRow.id,
        recipients: audienceRecipients,
        libraryName: resolvedLibraryName,
      };
    });

    // §7 audience-changed: return without sending so the UI can show a warning.
    if (step1.audienceChanged) {
      return {
        audienceChanged: true,
        sendTimeCount: step1.sendTimeCount,
        draftedCount: draftedRecipientCount,
      };
    }

    const { batchId, recipients, libraryName } = step1;

    // Step 2: send OUTSIDE any transaction — sendBatch manages its own short txs.
    const { sent, failed } = await sendBatch({
      tenantId,
      batchId,
      recipients: recipients.map((r) => ({
        memberId: r.memberId,
        email: r.email,
        displayName: r.displayName,
        bookTitle: r.bookTitle,
        dueDate: r.dueDate,
        pickupWindow: r.pickupWindow,
      })),
      subject,
      bodyTemplate: bodyMarkdown,
      libraryName,
    });

    // Step 3: short tx — update batch status + updatedAt.
    const status = failed === 0 ? "sent" : sent === 0 ? "failed" : "partial";
    await withTenantTx(ctx.tenantCtx, async (tx) => {
      await tx
        .update(emailBatches)
        .set({ status, updatedAt: new Date() })
        .where(eq(emailBatches.id, batchId));
    });

    // Post-commit: invalidate the emails cache tag for the tenant.
    revalidateTag(`tenant:${tenantId}:emails`, "default");

    return { audienceChanged: false, batchId, sent, failed };
  });
