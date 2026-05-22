/**
 * Transactional email senders.
 *
 * One function per transactional event:
 *   - sendHoldReadyEmail  — hold promoted to 'ready' (REQ-07-02)
 *   - sendWelcomeEmail    — member signup approved (REQ-07-03)
 *   - sendRejectionEmail  — member signup rejected (REQ-07-04)
 *
 * Bounce/complaint suppression (REQ-07-08): if the recipient's email_status is
 * not 'ok' (covers both 'bouncing' and 'complained'), a failed outgoing_emails
 * row is recorded and the function returns without sending.
 *
 * Transactional emails do NOT include an unsubscribe link (US-08).
 *
 * H1/H2 — INVARIANT: NO network send runs inside a DB transaction.
 * Each function manages its own short transactions internally:
 *   1. Short tx: load recipient + check suppression + assertEmailVolume.
 *      If suppressed/capped, record the failed row in the SAME short tx and return.
 *   2. Render + sendEmail with NO transaction open.
 *   3. Short tx: recordEmail with the resendId.
 *
 * Callers pass tenantId + param IDs — they must NOT hold an enclosing tx open.
 */

import { members } from "@/lib/db/schema/members";
import { tenants } from "@/lib/db/schema/tenants";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import { sendEmail } from "@/lib/notifications/email-client";
import {
  renderHoldReady,
  renderRejection,
  renderWelcome,
} from "@/lib/notifications/templates/render-email";
import { assertEmailVolume } from "@/lib/notifications/volume-cap";
import { eq } from "drizzle-orm";
import { recordEmail } from "./record-email";

// ---------------------------------------------------------------------------
// sendHoldReadyEmail
// ---------------------------------------------------------------------------

export interface SendHoldReadyEmailParams {
  holdId: string;
  memberId: string;
  bookTitle: string;
  /** Formatted pickup-by date string, e.g. "June 5, 2026". */
  pickupBy: string;
}

/**
 * Sends a hold-ready notification to the member.
 * Silently records a failed row and returns if the recipient is suppressed.
 * NO enclosing transaction may be open when this is called.
 */
export async function sendHoldReadyEmail(
  tenantId: string,
  params: SendHoldReadyEmailParams,
): Promise<void> {
  // Step 1: short tx — load + suppression check + volume cap.
  type LoadResult =
    | { skip: true }
    | {
        skip: false;
        email: string;
        displayName: string;
        subject: string;
        libraryName: string;
      };

  const loaded = await withSystemTenantTx<LoadResult>(tenantId, async (tx, ctx) => {
    const [member] = await tx
      .select({
        id: members.id,
        email: members.email,
        displayName: members.displayName,
        emailStatus: members.emailStatus,
      })
      .from(members)
      .where(eq(members.id, params.memberId));

    if (!member) return { skip: true };

    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    const libraryName = tenant?.name ?? "Stack Library";
    const subject = `Your hold is ready for pickup — "${params.bookTitle}"`;

    // Suppression: covers bouncing + complained (REQ-07-08, M3 fix).
    if (member.emailStatus !== "ok") {
      await recordEmail(tx, ctx, {
        memberId: member.id,
        toEmail: member.email,
        emailType: "hold_ready",
        deliveryStatus: "failed",
        subject,
        error: "Recipient suppressed: bouncing or complained",
      });
      return { skip: true };
    }

    await assertEmailVolume(tx, ctx);

    return {
      skip: false,
      email: member.email,
      displayName: member.displayName,
      subject,
      libraryName,
    };
  });

  if (loaded.skip) return;

  // Step 2: render + send — NO transaction open.
  const html = await renderHoldReady({
    memberName: loaded.displayName,
    bookTitle: params.bookTitle,
    pickupBy: params.pickupBy,
    libraryName: loaded.libraryName,
  });

  const sentAt = new Date();
  const sendResult = await sendEmail({ to: loaded.email, subject: loaded.subject, html });

  // Step 3: short tx — record the audit row.
  await withSystemTenantTx(tenantId, async (tx, ctx) => {
    await recordEmail(tx, ctx, {
      memberId: params.memberId,
      toEmail: loaded.email,
      emailType: "hold_ready",
      deliveryStatus: "queued",
      subject: loaded.subject,
      resendId: sendResult.id,
      sentAt,
    });
  });
}

// ---------------------------------------------------------------------------
// sendWelcomeEmail
// ---------------------------------------------------------------------------

export interface SendWelcomeEmailParams {
  memberId: string;
}

/**
 * Sends a welcome email to a newly approved member.
 * Silently records a failed row and returns if the recipient is suppressed.
 * NO enclosing transaction may be open when this is called.
 */
export async function sendWelcomeEmail(
  tenantId: string,
  params: SendWelcomeEmailParams,
): Promise<void> {
  type LoadResult =
    | { skip: true }
    | {
        skip: false;
        email: string;
        displayName: string;
        subject: string;
        libraryName: string;
        catalogUrl: string;
        cardNumber: string | null;
      };

  const loaded = await withSystemTenantTx<LoadResult>(tenantId, async (tx, ctx) => {
    const [member] = await tx
      .select({
        id: members.id,
        email: members.email,
        displayName: members.displayName,
        emailStatus: members.emailStatus,
        cardNumber: members.cardNumber,
      })
      .from(members)
      .where(eq(members.id, params.memberId));

    if (!member) return { skip: true };

    const [tenant] = await tx
      .select({ name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    const libraryName = tenant?.name ?? "Stack Library";
    const appUrl = process.env.APP_URL ?? "";
    const catalogUrl = tenant?.slug ? `${appUrl}/${tenant.slug}/catalog` : `${appUrl}/catalog`;
    const subject = `Welcome to ${libraryName} — your membership is approved`;

    // Suppression: covers bouncing + complained (REQ-07-08, M3 fix).
    if (member.emailStatus !== "ok") {
      await recordEmail(tx, ctx, {
        memberId: member.id,
        toEmail: member.email,
        emailType: "welcome",
        deliveryStatus: "failed",
        subject,
        error: "Recipient suppressed: bouncing or complained",
      });
      return { skip: true };
    }

    await assertEmailVolume(tx, ctx);

    return {
      skip: false,
      email: member.email,
      displayName: member.displayName,
      subject,
      libraryName,
      catalogUrl,
      cardNumber: member.cardNumber,
    };
  });

  if (loaded.skip) return;

  // Step 2: render + send — NO transaction open.
  // Pass cardNumber when available (REQ-07-03 US-03).
  // libraryAddress: no address column exists on tenants yet (follow-up task:
  // add tenants.library_address). We pass the library name as a fallback so
  // the template renders something useful while the column is pending.
  const html = await renderWelcome({
    memberName: loaded.displayName,
    libraryName: loaded.libraryName,
    catalogUrl: loaded.catalogUrl,
    ...(loaded.cardNumber !== null ? { cardNumber: loaded.cardNumber } : {}),
  });

  const sentAt = new Date();
  const sendResult = await sendEmail({ to: loaded.email, subject: loaded.subject, html });

  // Step 3: short tx — record the audit row.
  await withSystemTenantTx(tenantId, async (tx, ctx) => {
    await recordEmail(tx, ctx, {
      memberId: params.memberId,
      toEmail: loaded.email,
      emailType: "welcome",
      deliveryStatus: "queued",
      subject: loaded.subject,
      resendId: sendResult.id,
      sentAt,
    });
  });
}

// ---------------------------------------------------------------------------
// sendRejectionEmail
// ---------------------------------------------------------------------------

export interface SendRejectionEmailParams {
  memberId: string;
}

/**
 * Sends a rejection email to a denied applicant.
 * Uses members.rejectionReason for the body.
 * Silently records a failed row and returns if the recipient is suppressed.
 * NO enclosing transaction may be open when this is called.
 */
export async function sendRejectionEmail(
  tenantId: string,
  params: SendRejectionEmailParams,
): Promise<void> {
  type LoadResult =
    | { skip: true }
    | {
        skip: false;
        email: string;
        displayName: string;
        subject: string;
        libraryName: string;
        reason: string;
      };

  const loaded = await withSystemTenantTx<LoadResult>(tenantId, async (tx, ctx) => {
    const [member] = await tx
      .select({
        id: members.id,
        email: members.email,
        displayName: members.displayName,
        emailStatus: members.emailStatus,
        rejectionReason: members.rejectionReason,
      })
      .from(members)
      .where(eq(members.id, params.memberId));

    if (!member) return { skip: true };

    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    const libraryName = tenant?.name ?? "Stack Library";
    const reason = member.rejectionReason ?? "No reason provided.";
    const subject = `Update on your ${libraryName} membership application`;

    // Suppression: covers bouncing + complained (REQ-07-08, M3 fix).
    if (member.emailStatus !== "ok") {
      await recordEmail(tx, ctx, {
        memberId: member.id,
        toEmail: member.email,
        emailType: "rejection",
        deliveryStatus: "failed",
        subject,
        error: "Recipient suppressed: bouncing or complained",
      });
      return { skip: true };
    }

    await assertEmailVolume(tx, ctx);

    return {
      skip: false,
      email: member.email,
      displayName: member.displayName,
      subject,
      libraryName,
      reason,
    };
  });

  if (loaded.skip) return;

  // Step 2: render + send — NO transaction open.
  const html = await renderRejection({
    memberName: loaded.displayName,
    libraryName: loaded.libraryName,
    reason: loaded.reason,
  });

  const sentAt = new Date();
  const sendResult = await sendEmail({ to: loaded.email, subject: loaded.subject, html });

  // Step 3: short tx — record the audit row.
  await withSystemTenantTx(tenantId, async (tx, ctx) => {
    await recordEmail(tx, ctx, {
      memberId: params.memberId,
      toEmail: loaded.email,
      emailType: "rejection",
      deliveryStatus: "queued",
      subject: loaded.subject,
      resendId: sendResult.id,
      sentAt,
    });
  });
}
