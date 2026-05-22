/**
 * rejectMember — transitions a pending member to 'rejected' (REQ-04-05).
 *
 * Guards:
 *   1. Member must exist in this tenant (RLS provides isolation).
 *   2. Member must be in 'pending' status.
 *   3. Optimistic concurrency: expectedUpdatedAt must match stored updatedAt.
 *   4. rejectionReason must be non-empty (enforced by RejectMemberSchema upstream).
 *
 * Side effects (in same transaction):
 *   - Sets status='rejected', canBorrow=false, rejectedAt=now(), rejectedBy, rejectionReason.
 *   - Writes audit_log row with action='member.rejected'.
 *
 * NOT included (deferred to Spec 07):
 *   - Email to the requester with the rejection reason.
 *
 * Retention: rejected rows are retained for 90 days then anonymized by a worker
 * (NFR-04-04). The domain layer does NOT handle anonymization — that is a
 * scheduled background job in Spec 07 / Run C.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { members } from "@/lib/db/schema/members";
import type { Member } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { OptimisticConcurrencyError } from "@/lib/domain/books/errors";
import { and, eq } from "drizzle-orm";
import { canBorrow } from "./can-borrow";
import { MemberAlreadyRejectedError, MemberNotFoundError, MemberNotPendingError } from "./errors";
import type { RejectMemberInput } from "./schemas";

export interface RejectMemberResult {
  member: Member;
}

/**
 * @param callerMemberId - The member.id of the rejecting librarian/admin.
 *
 * @throws MemberNotFoundError          if memberId does not exist in this tenant.
 * @throws MemberAlreadyRejectedError   if status is already 'rejected'.
 * @throws MemberNotPendingError        if status is 'active', 'suspended', or 'inactive'.
 * @throws OptimisticConcurrencyError   if expectedUpdatedAt does not match.
 */
export async function rejectMember(
  tx: TxClient,
  ctx: TenantCtx,
  input: RejectMemberInput,
  callerMemberId: string,
): Promise<RejectMemberResult> {
  // 1. Read current member state.
  const [existing] = await tx.select().from(members).where(eq(members.id, input.memberId));

  if (!existing) {
    throw new MemberNotFoundError(input.memberId);
  }

  // 2. State-machine guards.
  if (existing.status === "rejected") {
    throw new MemberAlreadyRejectedError(input.memberId);
  }

  if (existing.status !== "pending") {
    throw new MemberNotPendingError(input.memberId, existing.status);
  }

  // 3. Optimistic concurrency check.
  if (existing.updatedAt.toISOString() !== input.expectedUpdatedAt) {
    throw new OptimisticConcurrencyError(input.memberId);
  }

  const now = new Date();
  const newStatus = "rejected" as const;

  // 4. Transition → rejected.
  const [updated] = await tx
    .update(members)
    .set({
      status: newStatus,
      canBorrow: canBorrow({ status: newStatus }),
      rejectedAt: now,
      rejectedBy: callerMemberId,
      rejectionReason: input.rejectionReason,
      updatedAt: now,
    })
    .where(and(eq(members.id, input.memberId), eq(members.updatedAt, existing.updatedAt)))
    .returning();

  if (!updated) {
    throw new OptimisticConcurrencyError(input.memberId);
  }

  await writeAuditLog(tx, ctx, {
    action: "member.rejected",
    subjectType: "member",
    subjectId: input.memberId,
    beforeJson: { status: existing.status },
    afterJson: {
      status: updated.status,
      rejectedBy: callerMemberId,
      rejectedAt: now.toISOString(),
      rejectionReason: input.rejectionReason,
    },
  });

  return { member: updated };
}
