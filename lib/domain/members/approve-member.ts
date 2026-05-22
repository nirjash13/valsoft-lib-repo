/**
 * approveMember — transitions a pending member to 'active' (REQ-04-04).
 *
 * Guards:
 *   1. Member must exist in this tenant (RLS provides isolation).
 *   2. Member must be in 'pending' status.
 *   3. Optimistic concurrency: expectedUpdatedAt must match stored updatedAt.
 *
 * Side effects (in same transaction):
 *   - Sets status='active', canBorrow=true, approvedAt=now(), approvedBy=caller's member id.
 *   - Writes audit_log row with action='member.approved'.
 *
 * NOT included (deferred to Spec 07 / Run B):
 *   - Auth0 Organization invitation send.
 *   - Welcome email workflow trigger.
 * These are triggered by the Server Action AFTER the transaction commits to avoid
 * coupling the DB write to an external HTTP call inside the tx.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { members } from "@/lib/db/schema/members";
import type { Member } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { OptimisticConcurrencyError } from "@/lib/domain/books/errors";
import { and, eq } from "drizzle-orm";
import { canBorrow } from "./can-borrow";
import { MemberAlreadyApprovedError, MemberNotFoundError, MemberNotPendingError } from "./errors";
import { generateCardNumber } from "./generate-card-number";
import type { ApproveMemberInput } from "./schemas";

export interface ApproveMemberResult {
  member: Member;
}

/**
 * @param callerMemberId - The member.id of the approving librarian/admin.
 *                         Used as approvedBy FK. Must be the caller's own member row.
 *
 * @throws MemberNotFoundError          if memberId does not exist in this tenant.
 * @throws MemberAlreadyApprovedError   if status is already 'active'.
 * @throws MemberNotPendingError        if status is 'rejected', 'suspended', or 'inactive'.
 * @throws OptimisticConcurrencyError   if expectedUpdatedAt does not match.
 */
export async function approveMember(
  tx: TxClient,
  ctx: TenantCtx,
  input: ApproveMemberInput,
  callerMemberId: string,
): Promise<ApproveMemberResult> {
  // 1. Read current member state.
  const [existing] = await tx.select().from(members).where(eq(members.id, input.memberId));

  if (!existing) {
    throw new MemberNotFoundError(input.memberId);
  }

  // 2. State-machine guards.
  if (existing.status === "active") {
    throw new MemberAlreadyApprovedError(input.memberId);
  }

  if (existing.status !== "pending") {
    throw new MemberNotPendingError(input.memberId, existing.status);
  }

  // 3. Optimistic concurrency check.
  if (existing.updatedAt.toISOString() !== input.expectedUpdatedAt) {
    throw new OptimisticConcurrencyError(input.memberId);
  }

  const now = new Date();
  const newStatus = "active" as const;
  // Generate the card number from the member's own id (deterministic, stable).
  const cardNumber = generateCardNumber(input.memberId);

  // 4. Transition → active.
  const [updated] = await tx
    .update(members)
    .set({
      status: newStatus,
      canBorrow: canBorrow({ status: newStatus }),
      approvedAt: now,
      approvedBy: callerMemberId,
      rejectedAt: null,
      rejectedBy: null,
      rejectionReason: null,
      cardNumber,
      updatedAt: now,
    })
    .where(
      and(
        eq(members.id, input.memberId),
        // Re-check updatedAt at write time for concurrent approval/rejection protection.
        eq(members.updatedAt, existing.updatedAt),
      ),
    )
    .returning();

  if (!updated) {
    // Another concurrent operation (approve or reject) committed first.
    throw new OptimisticConcurrencyError(input.memberId);
  }

  await writeAuditLog(tx, ctx, {
    action: "member.approved",
    subjectType: "member",
    subjectId: input.memberId,
    beforeJson: { status: existing.status },
    afterJson: {
      status: updated.status,
      approvedBy: callerMemberId,
      approvedAt: now.toISOString(),
    },
  });

  return { member: updated };
}
