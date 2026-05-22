/**
 * Resend email client with DEV-OUTBOX fallback.
 *
 * Design mirrors the degrade-gracefully philosophy of `lib/ai/gateway.ts`:
 *   - When `RESEND_API_KEY` is set → real send via Resend.
 *   - When absent → DEV-OUTBOX mode: logs to console, returns a synthetic ID.
 *     The app remains fully demoable without Resend configured.
 *   - On a real Resend error response → throws `EmailSendError`.
 *   - NEVER throws on a missing API key.
 *
 * "From" address: read `RESEND_FROM_EMAIL` with a documented fallback
 * of `"Stack Library <onboarding@resend.dev>"` (Resend's safe sandbox address).
 */

import { Resend } from "resend";
import { EmailSendError } from "./errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export type SendEmailResult = { id: string; devMode?: never } | { id: string; devMode: true };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Fallback "from" address used when RESEND_FROM_EMAIL is not set.
 * `onboarding@resend.dev` is Resend's shared sandbox address — always
 * accepted without domain verification, safe for demos and CI.
 */
const DEFAULT_FROM = "Stack Library <onboarding@resend.dev>";

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

/**
 * Sends an email via Resend, or falls back to DEV-OUTBOX mode when
 * `RESEND_API_KEY` is absent.
 *
 * @returns `{ id }` — Resend message ID in production, or
 *          `{ id: "dev-outbox:<uuid>", devMode: true }` in dev mode.
 * @throws EmailSendError on a real Resend API error (4xx / 5xx).
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  // ── DEV-OUTBOX mode ────────────────────────────────────────────────────────
  if (!apiKey) {
    const devId = `dev-outbox:${crypto.randomUUID()}`;
    console.info("[email:dev-outbox] →", params.to, params.subject);
    return { id: devId, devMode: true };
  }

  // ── Real Resend send ───────────────────────────────────────────────────────
  const from = process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM;
  const resend = new Resend(apiKey);

  const sendOptions: Parameters<Resend["emails"]["send"]>[0] = {
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    ...(params.replyTo !== undefined ? { replyTo: params.replyTo } : {}),
  };

  const response = await resend.emails.send(sendOptions);

  if (response.error !== null) {
    throw new EmailSendError(
      response.error.statusCode,
      response.error.name,
      response.error.message,
    );
  }

  return { id: response.data.id };
}
