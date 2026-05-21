/**
 * listLoansByMember — returns active loans for a member with enriched status flags (REQ-03-07).
 */

import { holds } from "@/lib/db/schema/holds";
import { loans } from "@/lib/db/schema/loans";
import type { LoanRow } from "@/lib/db/schema/loans";
import { tenants } from "@/lib/db/schema/tenants";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { canRenew } from "./loan-policy";

export interface ActiveLoanView extends LoanRow {
  canRenew: boolean;
  isOverdue: boolean;
}

/**
 * Returns all active (unreturned) loans for a member, ordered by due date ascending.
 * Enriches each loan with canRenew and isOverdue flags (REQ-03-07, REQ-03-08).
 */
export async function listLoansByMember(
  tx: TxClient,
  ctx: TenantCtx,
  memberId: string,
): Promise<ReadonlyArray<ActiveLoanView>> {
  // Read tenant policy once.
  const [tenant] = await tx
    .select({ maxRenewals: tenants.maxRenewals })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId));

  const maxRenewals = tenant?.maxRenewals ?? 2;

  // Fetch active loans.
  const activeLoans = await tx
    .select()
    .from(loans)
    .where(and(eq(loans.memberId, memberId), isNull(loans.returnedAt)))
    .orderBy(asc(loans.dueAt));

  if (activeLoans.length === 0) return [];

  // Fetch books with any queued/ready hold (to check renewal eligibility).
  const bookIds = activeLoans.map((l) => l.bookId);
  const blockedBookRows = await tx
    .selectDistinct({ bookId: holds.bookId })
    .from(holds)
    .where(and(inArray(holds.bookId, bookIds), inArray(holds.status, ["queued", "ready"])));

  const blockedBookIdSet = new Set(blockedBookRows.map((r) => r.bookId));
  const now = new Date();

  return activeLoans.map((loan) => ({
    ...loan,
    canRenew: canRenew({
      renewedCount: loan.renewedCount,
      maxRenewals,
      hasQueuedHold: blockedBookIdSet.has(loan.bookId),
    }),
    isOverdue: loan.dueAt < now,
  }));
}
