/**
 * Post-commit trigger facade for notification side effects.
 *
 * Each function calls the refactored send-transactional helpers which now manage
 * their own short transactions internally. No enclosing withSystemTenantTx is
 * opened here — callers must NOT hold a DB transaction open when calling these.
 *
 * CRITICAL: callers MUST wrap every call in try/catch + console.error.
 * A failed email must never fail or roll back the originating mutation.
 *
 * SYSTEM-OWNER PATH — DO NOT IMPORT FROM TENANT-FACING CODE except via
 * Server Action post-commit blocks.
 */

import { books } from "@/lib/db/schema/books";
import { holds } from "@/lib/db/schema/holds";
import { tenants } from "@/lib/db/schema/tenants";
import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import { eq } from "drizzle-orm";
import { sendHoldReadyEmail, sendRejectionEmail, sendWelcomeEmail } from "./send-transactional";

// ---------------------------------------------------------------------------
// onHoldPromoted
// ---------------------------------------------------------------------------

export interface OnHoldPromotedParams {
  tenantId: string;
  holdId: string;
}

/**
 * Fires after a hold is promoted to 'ready'.
 * Loads the hold + book + tenant pickup hours in a short tx, then delegates
 * to sendHoldReadyEmail (which manages its own short txs around the network call).
 */
export async function onHoldPromoted(params: OnHoldPromotedParams): Promise<void> {
  const { tenantId, holdId } = params;

  // Short tx: resolve ids and data needed before the network send.
  const resolved = await withSystemTenantTx(tenantId, async (tx, _ctx) => {
    const [hold] = await tx
      .select({
        id: holds.id,
        memberId: holds.memberId,
        bookId: holds.bookId,
        readyUntil: holds.readyUntil,
      })
      .from(holds)
      .where(eq(holds.id, holdId));

    if (!hold) return null;

    const [book] = await tx
      .select({ title: books.title })
      .from(books)
      .where(eq(books.id, hold.bookId));

    const bookTitle = book?.title ?? "your requested book";

    const [tenant] = await tx
      .select({ holdPickupHours: tenants.holdPickupHours })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    const pickupByDate =
      hold.readyUntil ?? new Date(Date.now() + (tenant?.holdPickupHours ?? 72) * 60 * 60 * 1000);
    const pickupBy = pickupByDate.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

    return { memberId: hold.memberId, bookTitle, pickupBy };
  });

  if (!resolved) return;

  // Send outside any transaction — sendHoldReadyEmail manages its own short txs.
  await sendHoldReadyEmail(tenantId, {
    holdId,
    memberId: resolved.memberId,
    bookTitle: resolved.bookTitle,
    pickupBy: resolved.pickupBy,
  });
}

// ---------------------------------------------------------------------------
// onMemberApproved
// ---------------------------------------------------------------------------

export interface OnMemberApprovedParams {
  tenantId: string;
  memberId: string;
}

/**
 * Fires after a member signup is approved.
 * Delegates to sendWelcomeEmail (which manages its own short txs).
 */
export async function onMemberApproved(params: OnMemberApprovedParams): Promise<void> {
  const { tenantId, memberId } = params;
  // sendWelcomeEmail manages its own short txs internally.
  await sendWelcomeEmail(tenantId, { memberId });
}

// ---------------------------------------------------------------------------
// onMemberRejected
// ---------------------------------------------------------------------------

export interface OnMemberRejectedParams {
  tenantId: string;
  memberId: string;
}

/**
 * Fires after a member signup is rejected.
 * Delegates to sendRejectionEmail (which manages its own short txs).
 */
export async function onMemberRejected(params: OnMemberRejectedParams): Promise<void> {
  const { tenantId, memberId } = params;
  // sendRejectionEmail manages its own short txs internally (including rejectionReason load).
  await sendRejectionEmail(tenantId, { memberId });
}
