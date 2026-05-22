/**
 * Notifications page — compose batch emails + delivery log.
 *
 * RSC query. Gated on email:compose permission.
 *
 * US-07: librarian can view delivery log of recent emails.
 * REQ-07-08: bounce banner shown when members have bouncing addresses.
 */

import { BounceBanner } from "@/components/notifications/bounce-banner";
import { ComposeBatch } from "@/components/notifications/compose-batch";
import { DeliveryLog } from "@/components/notifications/delivery-log";
import type { DeliveryLogRow } from "@/components/notifications/delivery-log";
import { EmailVolumeMeter } from "@/components/notifications/email-volume-meter";
import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { members } from "@/lib/db/schema/members";
import { outgoingEmails } from "@/lib/db/schema/outgoing-emails";
import { tenants } from "@/lib/db/schema/tenants";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { REAL_SEND_STATUSES } from "@/lib/notifications/volume-cap";
import { and, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";

export const metadata = {
  title: "Notifications — Stack",
};

export default async function NotificationsPage() {
  const session = await requireSession();
  const ability = buildAbility(session.roles);

  // CASL gate: only librarians and tenant_admins can compose emails.
  if (!ability.can("compose", "Email")) {
    return (
      <div className="flex flex-col gap-2 py-16 text-center">
        <p className="text-text-primary font-semibold">Access restricted</p>
        <p className="text-sm text-text-tertiary">
          You do not have permission to access notifications.
        </p>
      </div>
    );
  }

  const tenantCtx = await sessionToTenantCtx(session);

  // Fetch delivery log + bounce count + volume meter data in a single transaction.
  const { logRows, bouncingCount, sentThisMonth, emailMonthlyCap } = await withTenantTx(
    tenantCtx,
    async (tx, txCtx) => {
      // Recent outgoing_emails — most recent 50 rows.
      const emailRows = await tx
        .select({
          id: outgoingEmails.id,
          toEmail: outgoingEmails.toEmail,
          emailType: outgoingEmails.emailType,
          deliveryStatus: outgoingEmails.deliveryStatus,
          subject: outgoingEmails.subject,
          createdAt: outgoingEmails.createdAt,
        })
        .from(outgoingEmails)
        .where(eq(outgoingEmails.tenantId, txCtx.tenantId))
        .orderBy(desc(outgoingEmails.createdAt))
        .limit(50);

      // Count members with a bouncing email status.
      const [bounceRow] = await tx
        .select({ c: count() })
        .from(members)
        .where(
          and(
            eq(members.tenantId, txCtx.tenantId),
            eq(members.emailStatus, "bouncing"),
            isNull(members.deletedAt),
          ),
        );

      // Month-to-date real send count (NFR-07-03 / US-07 volume meter).
      // Reuse REAL_SEND_STATUSES from volume-cap.ts — same definition as assertEmailVolume.
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const [volumeRow] = await tx
        .select({ sent: count() })
        .from(outgoingEmails)
        .where(
          and(
            eq(outgoingEmails.tenantId, txCtx.tenantId),
            gte(outgoingEmails.createdAt, monthStart),
            inArray(outgoingEmails.deliveryStatus, [...REAL_SEND_STATUSES]),
          ),
        );

      // Read the tenant's cap.
      const [tenantRow] = await tx
        .select({ emailMonthlyCap: tenants.emailMonthlyCap })
        .from(tenants)
        .where(eq(tenants.id, txCtx.tenantId));

      return {
        logRows: emailRows as DeliveryLogRow[],
        bouncingCount: Number(bounceRow?.c ?? 0),
        sentThisMonth: Number(volumeRow?.sent ?? 0),
        emailMonthlyCap: tenantRow?.emailMonthlyCap ?? 5000,
      };
    },
  );

  return (
    <div className="space-y-8 max-w-4xl">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">Notifications</h1>
        <p className="mt-1 text-sm text-text-tertiary">
          Compose AI-drafted batch emails to patron segments and review delivery history.
        </p>
      </header>

      {/* US-07 / NFR-07-03: email volume meter */}
      <EmailVolumeMeter sentThisMonth={sentThisMonth} cap={emailMonthlyCap} />

      {/* REQ-07-08: bounce warning */}
      <BounceBanner bouncingCount={bouncingCount} />

      {/* Compose panel */}
      <section aria-labelledby="compose-heading">
        <h2 id="compose-heading" className="text-h3 font-semibold text-text-primary mb-4">
          Compose batch reminder
        </h2>
        <div className="rounded-lg border border-border-subtle bg-surface p-6">
          <ComposeBatch />
        </div>
      </section>

      {/* Delivery log */}
      <section aria-labelledby="log-heading">
        <h2 id="log-heading" className="text-h3 font-semibold text-text-primary mb-4">
          Delivery log
        </h2>
        <DeliveryLog rows={logRows} />
      </section>
    </div>
  );
}
