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
 *
 * REQ-07-08: 5xx and network errors are retried up to 3 times total with
 * exponential backoff (250 ms, 500 ms, 1 000 ms). 4xx errors are permanent
 * and are NOT retried. Backoff delays can be overridden via the exported
 * `_retryDelaysMs` array to keep unit tests fast.
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

/**
 * Delay in milliseconds between successive retry attempts (attempt 1→2, 2→3).
 * Override this array in tests to avoid real sleeps:
 *   `import { _retryDelaysMs } from "@/lib/notifications/email-client"; _retryDelaysMs[0] = 0;`
 *
 * Exported as a mutable array so tests can zero the delays without `vi.useFakeTimers`.
 */
export const _retryDelaysMs: [number, number] = [250, 500];

const MAX_ATTEMPTS = 3;

/** Returns true for transient errors that warrant a retry (5xx or no status code = network error). */
function isRetryable(err: EmailSendError): boolean {
  if (err.statusCode === null) return true; // network-level error
  return err.statusCode >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

/**
 * Sends an email via Resend, or falls back to DEV-OUTBOX mode when
 * `RESEND_API_KEY` is absent.
 *
 * Retries up to 3 attempts total on 5xx / network errors with exponential
 * backoff. 4xx errors are not retried (permanent failure).
 *
 * @returns `{ id }` — Resend message ID in production, or
 *          `{ id: "dev-outbox:<uuid>", devMode: true }` in dev mode.
 * @throws EmailSendError on a permanent Resend API error (4xx) or after all
 *         retry attempts are exhausted on a 5xx / network error.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  // ── DEV-OUTBOX mode ────────────────────────────────────────────────────────
  if (!apiKey) {
    const devId = `dev-outbox:${crypto.randomUUID()}`;
    console.info("[email:dev-outbox] →", params.to, params.subject);
    return { id: devId, devMode: true };
  }

  // ── Real Resend send with retry ────────────────────────────────────────────
  const from = process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM;
  const resend = new Resend(apiKey);

  const sendOptions: Parameters<Resend["emails"]["send"]>[0] = {
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    ...(params.replyTo !== undefined ? { replyTo: params.replyTo } : {}),
  };

  let lastError: EmailSendError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await resend.emails.send(sendOptions);

    if (response.error === null) {
      return { id: response.data.id };
    }

    const err = new EmailSendError(
      response.error.statusCode,
      response.error.name,
      response.error.message,
    );

    // 4xx errors are permanent — fail immediately without retry.
    if (!isRetryable(err)) {
      throw err;
    }

    lastError = err;

    if (attempt < MAX_ATTEMPTS) {
      const delay = _retryDelaysMs[attempt - 1] ?? 0;
      console.warn(
        `[email-client] Resend 5xx on attempt ${attempt}/${MAX_ATTEMPTS}; retrying in ${delay}ms`,
        err.message,
      );
      await sleep(delay);
    }
  }

  // All attempts exhausted.
  throw lastError ?? new EmailSendError(null, "UnknownError", "All retry attempts failed");
}
