/**
 * POST /api/webhooks/resend — Resend delivery webhook handler (REQ-07-08).
 *
 * Verifies the Svix-style HMAC-SHA256 signature from Resend, then updates
 * outgoing_emails.delivery_status and (on bounce/complaint) members.email_status.
 *
 * Signature algorithm (Svix-compatible):
 *   signedContent = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   secret = base64decode(RESEND_WEBHOOK_SECRET.replace(/^whsec_/, ""))
 *   expectedSig = base64(HMAC-SHA256(secret, signedContent))
 *   header "svix-signature" contains space-delimited "v1,<sig>" pairs — accept if any matches.
 *
 * Dev mode: if RESEND_WEBHOOK_SECRET is absent, signature verification is skipped
 * (console.warn once). This mirrors the email-client dev-outbox pattern.
 *
 * Race handling (REQ-07-08): if no outgoing_emails row matches the resend_id yet,
 * return 503 so Resend retries later (the send may not have been recorded yet).
 *
 * Cross-tenant path: looks up the outgoing_emails row by resend_id via the owner
 * pool (BYPASSRLS) to resolve tenant_id, then uses withSystemTenantTx for all writes.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getOwnerPool } from "@/lib/db/owner-pool";
import { members } from "@/lib/db/schema/members";
import { outgoingEmails } from "@/lib/db/schema/outgoing-emails";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import { problem } from "@/lib/http/problem";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs"; // Needs pg WebSocket driver — not Edge-compatible.

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

let _devModeWarned = false;

/**
 * Verifies the Svix-style HMAC-SHA256 signature on an incoming Resend webhook.
 *
 * Returns true if the signature is valid (or if the secret is absent → dev mode).
 * Returns false if the secret is set but verification fails.
 */
function verifyResendSignature(
  rawBody: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  if (!secret) {
    // DEV MODE: skip verification, warn once per process lifetime.
    if (!_devModeWarned) {
      console.warn(
        "[resend-webhook] RESEND_WEBHOOK_SECRET is not set — " +
          "signature verification disabled (dev mode). Set it in production.",
      );
      _devModeWarned = true;
    }
    return true;
  }

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  // Strip the "whsec_" prefix and base64-decode to get raw secret bytes.
  const secretBase64 = secret.replace(/^whsec_/, "");
  const secretBytes = Buffer.from(secretBase64, "base64");

  // Signed content: `${svix-id}.${svix-timestamp}.${rawBody}`
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;

  // Compute expected signature.
  const expectedSigBase64 = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  const expectedBuf = Buffer.from(expectedSigBase64, "utf8");

  // "svix-signature" is space-delimited "v1,<sig>" pairs — accept if any matches.
  const signatures = svixSignature.split(" ");
  for (const pair of signatures) {
    const commaIdx = pair.indexOf(",");
    if (commaIdx === -1) continue;
    const candidate = pair.slice(commaIdx + 1);
    const candidateBuf = Buffer.from(candidate, "utf8");

    // Constant-time compare — must use same-length buffers.
    if (expectedBuf.length === candidateBuf.length && timingSafeEqual(expectedBuf, candidateBuf)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Event schema
// ---------------------------------------------------------------------------

const ResendEventSchema = z.object({
  type: z.string(),
  data: z.object({
    email_id: z.string(),
    to: z.array(z.string()).optional(),
  }),
});

type ResendEventType =
  | "email.delivered"
  | "email.bounced"
  | "email.complained"
  | (string & Record<never, never>);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // Read raw body as text for signature verification (before any parsing).
  const rawBody = await req.text();

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!verifyResendSignature(rawBody, svixId, svixTimestamp, svixSignature)) {
    return problem(401, "Unauthorized", "Webhook signature verification failed.");
  }

  // Parse the event body — one acceptable cast at the JSON.parse boundary.
  const parseResult = ResendEventSchema.safeParse(JSON.parse(rawBody) as unknown);

  if (!parseResult.success) {
    // Unknown / malformed payload — ack so Resend stops retrying.
    return Response.json({ ok: true, note: "unrecognised payload shape" });
  }

  const event = parseResult.data;
  const eventType = event.type as ResendEventType;
  const resendId = event.data.email_id;

  // Only handle delivery-status events we care about.
  if (
    eventType !== "email.delivered" &&
    eventType !== "email.bounced" &&
    eventType !== "email.complained"
  ) {
    // Acknowledge no-op events so Resend doesn't retry them.
    return Response.json({ ok: true, note: "event type not handled" });
  }

  // --- Cross-tenant lookup via owner pool (BYPASSRLS) ---
  const pool = getOwnerPool();
  const client = await pool.connect();

  let emailRow: { id: string; tenantId: string; memberId: string | null } | undefined;

  try {
    const result = await client.query<{
      id: string;
      tenant_id: string;
      member_id: string | null;
    }>("SELECT id, tenant_id, member_id FROM outgoing_emails WHERE resend_id = $1 LIMIT 1", [
      resendId,
    ]);

    emailRow =
      result.rows[0] !== undefined
        ? {
            id: result.rows[0].id,
            tenantId: result.rows[0].tenant_id,
            memberId: result.rows[0].member_id,
          }
        : undefined;
  } finally {
    client.release();
  }

  // REQ-07-08 race: no row yet → 503 so Resend retries after the send is recorded.
  if (emailRow === undefined) {
    return problem(
      503,
      "Service Unavailable",
      `No outgoing_emails row found for resend_id=${resendId}. Retry later.`,
    );
  }

  const { id: emailId, tenantId, memberId } = emailRow;

  // --- Tenant-scoped writes under RLS (withSystemTenantTx) ---
  await withSystemTenantTx(tenantId, async (tx) => {
    if (eventType === "email.delivered") {
      await tx
        .update(outgoingEmails)
        .set({ deliveryStatus: "delivered", updatedAt: new Date() })
        .where(eq(outgoingEmails.id, emailId));
    } else if (eventType === "email.bounced") {
      await tx
        .update(outgoingEmails)
        .set({ deliveryStatus: "bounced", updatedAt: new Date() })
        .where(eq(outgoingEmails.id, emailId));

      // Suppress future sends for this member (REQ-07-08 bounce suppression).
      if (memberId !== null) {
        await tx
          .update(members)
          .set({ emailStatus: "bouncing", updatedAt: new Date() })
          .where(eq(members.id, memberId));
      }
    } else if (eventType === "email.complained") {
      await tx
        .update(outgoingEmails)
        .set({ deliveryStatus: "complained", updatedAt: new Date() })
        .where(eq(outgoingEmails.id, emailId));

      // Mark member as complained — lifecycle sends suppressed.
      if (memberId !== null) {
        await tx
          .update(members)
          .set({ emailStatus: "complained", updatedAt: new Date() })
          .where(eq(members.id, memberId));
      }
    }
  });

  return Response.json({ ok: true });
}
