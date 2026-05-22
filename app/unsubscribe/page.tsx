/**
 * /unsubscribe — public one-click unsubscribe page (NFR-07-06).
 *
 * Lives OUTSIDE the (app) route group so the authenticated layout does not wrap it.
 * No Auth0 session required — the unsubscribe token carries the memberId and is
 * verified via HMAC-SHA256 (lib/notifications/unsubscribe-token.ts).
 *
 * Flow:
 *   1. Read ?token= from searchParams.
 *   2. verifyUnsubscribeToken(token) → memberId (string) or null.
 *   3. Invalid/absent → render a friendly error card (no data leak).
 *   4. Valid → resolve tenant_id via owner pool (BYPASSRLS), then
 *      withSystemTenantTx(tenantId) to set lifecycle_emails_enabled=false.
 *   5. Render confirmation card. The click IS the confirmation (NFR-07-06: ≤2s).
 */

import { getOwnerPool } from "@/lib/db/owner-pool";
import { members } from "@/lib/db/schema/members";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import { verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UnsubscribePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const params = await searchParams;
  const rawToken = params.token;
  const token = typeof rawToken === "string" ? rawToken : null;

  // --- Verify token ---
  const memberId = token !== null ? verifyUnsubscribeToken(token) : null;

  if (memberId === null) {
    return (
      <PageShell>
        <ErrorCard />
      </PageShell>
    );
  }

  // --- Resolve tenant via owner pool (BYPASSRLS cross-tenant lookup) ---
  const pool = getOwnerPool();
  const client = await pool.connect();

  let tenantId: string | undefined;
  let alreadyOptedOut = false;

  try {
    const result = await client.query<{
      tenant_id: string;
      lifecycle_emails_enabled: boolean;
    }>(
      "SELECT tenant_id, lifecycle_emails_enabled FROM members WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
      [memberId],
    );
    const row = result.rows[0];
    if (row !== undefined) {
      tenantId = row.tenant_id;
      alreadyOptedOut = !row.lifecycle_emails_enabled;
    }
  } finally {
    client.release();
  }

  // Member not found (deleted or invalid id embedded in token).
  if (tenantId === undefined) {
    return (
      <PageShell>
        <ErrorCard />
      </PageShell>
    );
  }

  // If already opted out, skip the write and show confirmation immediately.
  if (!alreadyOptedOut) {
    await withSystemTenantTx(tenantId, async (tx) => {
      await tx
        .update(members)
        .set({ lifecycleEmailsEnabled: false, updatedAt: new Date() })
        .where(eq(members.id, memberId));
    });
  }

  return (
    <PageShell>
      <SuccessCard />
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// UI components (server-only, no "use client" needed)
// ---------------------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">{children}</div>
      </body>
    </html>
  );
}

function ErrorCard() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
      <div className="text-4xl mb-4" aria-hidden="true">
        &#x26A0;
      </div>
      <h1 className="text-xl font-semibold text-gray-900 mb-2">Link invalid or expired</h1>
      <p className="text-gray-500 text-sm leading-relaxed">
        This unsubscribe link is invalid or has expired. If you&apos;d like to manage your email
        preferences, please contact your library.
      </p>
    </div>
  );
}

function SuccessCard() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
      <div className="text-4xl mb-4" aria-hidden="true">
        &#x2713;
      </div>
      <h1 className="text-xl font-semibold text-gray-900 mb-2">You&apos;ve been unsubscribed</h1>
      <p className="text-gray-500 text-sm leading-relaxed">
        You&apos;ll no longer receive reminder emails from your library. You&apos;ll still receive
        important account emails like signup confirmations and hold notifications.
      </p>
    </div>
  );
}
