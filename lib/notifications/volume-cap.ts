/**
 * assertEmailVolume — tenant monthly email send-cap guard.
 *
 * Counts outgoing_emails rows created in the current calendar month for the
 * tenant. If the count is >= tenants.email_monthly_cap, throws EmailVolumeCapError.
 *
 * Called before every real send (send-transactional, send-lifecycle, send-batch).
 * Must run inside an existing withTenantTx / withSystemTenantTx transaction so
 * the RLS policy on outgoing_emails is enforced (Layer 4).
 *
 * NFR-07-03: "Hard cap at tenant.email_monthly_cap; throws 402 when breached."
 */

import { outgoingEmails } from "@/lib/db/schema/outgoing-emails";
import { tenants } from "@/lib/db/schema/tenants";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { EmailVolumeCapError } from "@/lib/notifications/errors";
import { and, count, eq, gte, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// assertEmailVolume
// ---------------------------------------------------------------------------

/**
 * Throws `EmailVolumeCapError` when the tenant has already sent >= their monthly cap.
 *
 * Uses `COUNT(*)` over the current calendar-month window so it is accurate to
 * the second, even for tenants that sent many emails earlier in the month.
 *
 * @throws EmailVolumeCapError if the cap has been reached.
 */
export async function assertEmailVolume(tx: TxClient, ctx: TenantCtx): Promise<void> {
  // Start of the current calendar month in UTC.
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Fetch the tenant's cap.
  const [tenantRow] = await tx
    .select({ emailMonthlyCap: tenants.emailMonthlyCap })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId));

  const cap = tenantRow?.emailMonthlyCap ?? 5000;

  // Count actual send attempts this calendar month — exclude skipped/failed rows
  // that represent zero real Resend dispatches (M4 fix: NFR-07-03 email volume cap).
  const ACTUAL_SEND_STATUSES = ["queued", "sent", "delivered", "bounced", "complained"] as const;

  const [countRow] = await tx
    .select({ sent: count() })
    .from(outgoingEmails)
    .where(
      and(
        eq(outgoingEmails.tenantId, ctx.tenantId),
        gte(outgoingEmails.createdAt, monthStart),
        inArray(outgoingEmails.deliveryStatus, [...ACTUAL_SEND_STATUSES]),
      ),
    );

  const sent = countRow?.sent ?? 0;

  if (sent >= cap) {
    throw new EmailVolumeCapError(ctx.tenantId);
  }
}
