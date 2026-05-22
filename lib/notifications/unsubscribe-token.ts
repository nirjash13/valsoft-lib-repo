/**
 * HMAC-SHA256 unsubscribe token helpers.
 *
 * Token format: `<memberId>.<hmac_base64url>`
 *
 * The HMAC is computed over `memberId` with the key from
 * `process.env.UNSUBSCRIBE_SECRET`. When the env var is absent a documented
 * dev-only fallback constant is used — the app stays demoable without the
 * secret configured (matching the dev-outbox pattern in email-client.ts).
 *
 * WARNING: Do NOT use the dev fallback secret in production. Set
 * `UNSUBSCRIBE_SECRET` to a securely-generated random string (≥32 bytes)
 * before going live.
 *
 * Pure functions — no DB, no HTTP, no side effects.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Dev-only fallback — intentionally weak so it is obvious it must be replaced.
 * Never use this value in a production environment.
 */
const DEV_FALLBACK_SECRET = "dev-unsubscribe-secret-replace-in-prod";

const SEPARATOR = ".";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSecret(): string {
  return process.env.UNSUBSCRIBE_SECRET ?? DEV_FALLBACK_SECRET;
}

function computeHmac(memberId: string, secret: string): string {
  return createHmac("sha256", secret).update(memberId).digest("base64url");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a tamper-evident unsubscribe token for `memberId`.
 *
 * @returns `<memberId>.<hmac_base64url>`
 */
export function signUnsubscribeToken(memberId: string): string {
  const hmac = computeHmac(memberId, getSecret());
  return `${memberId}${SEPARATOR}${hmac}`;
}

/**
 * Verifies an unsubscribe token and returns the embedded `memberId`, or
 * `null` if the token is malformed or the HMAC does not match.
 *
 * Uses a timing-safe comparison to prevent timing attacks.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  const separatorIndex = token.indexOf(SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  const memberId = token.slice(0, separatorIndex);
  const providedHmac = token.slice(separatorIndex + 1);

  if (!memberId || !providedHmac) {
    return null;
  }

  const expectedHmac = computeHmac(memberId, getSecret());

  // Constant-time comparison to prevent timing oracle attacks.
  const expected = Buffer.from(expectedHmac, "utf8");
  const provided = Buffer.from(providedHmac, "utf8");

  if (expected.length !== provided.length) {
    return null;
  }

  if (!timingSafeEqual(expected, provided)) {
    return null;
  }

  return memberId;
}
