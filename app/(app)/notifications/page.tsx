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
import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { members } from "@/lib/db/schema/members";
import { outgoingEmails } from "@/lib/db/schema/outgoing-emails";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { and, count, desc, eq, isNull } from "drizzle-orm";

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

  // Fetch delivery log + bounce count in a single transaction.
  const { logRows, bouncingCount } = await withTenantTx(tenantCtx, async (tx, txCtx) => {
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

    return {
      logRows: emailRows as DeliveryLogRow[],
      bouncingCount: Number(bounceRow?.c ?? 0),
    };
  });

  return (
    <div className="space-y-8 max-w-4xl">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">Notifications</h1>
        <p className="mt-1 text-sm text-text-tertiary">
          Compose AI-drafted batch emails to patron segments and review delivery history.
        </p>
      </header>

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
