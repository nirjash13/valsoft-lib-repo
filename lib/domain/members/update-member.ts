/**
 * updateMember — member self-updates their own profile (REQ-04-09).
 *
 * Updatable fields: displayName, phone.
 * Non-updatable via this function: status, role, email, auth0_user_id.
 *
 * Ownership check: callerMemberId must match input.memberId. Staff do NOT use
 * this function to update members; they use a separate privileged path (Run B UI).
 *
 * Optimistic concurrency: expectedUpdatedAt must match stored updatedAt.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { members } from "@/lib/db/schema/members";
import type { Member } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { OptimisticConcurrencyError } from "@/lib/domain/books/errors";
import { and, eq } from "drizzle-orm";
import { MemberNotFoundError, MemberOwnershipDeniedError } from "./errors";
import type { UpdateMemberInput } from "./schemas";

export interface UpdateMemberResult {
  member: Member;
}

/**
 * @param callerMemberId - The member.id of the authenticated caller (from getMemberByUserId).
 *
 * @throws MemberNotFoundError          if memberId does not exist in this tenant.
 * @throws MemberOwnershipDeniedError   if callerMemberId !== input.memberId.
 * @throws OptimisticConcurrencyError   if expectedUpdatedAt does not match.
 */
export async function updateMember(
  tx: TxClient,
  ctx: TenantCtx,
  input: UpdateMemberInput,
  callerMemberId: string,
): Promise<UpdateMemberResult> {
  // 1. Ownership check — members may only update their own profile.
  if (callerMemberId !== input.memberId) {
    throw new MemberOwnershipDeniedError(input.memberId, callerMemberId);
  }

  // 2. Read current state.
  const [existing] = await tx.select().from(members).where(eq(members.id, input.memberId));

  if (!existing) {
    throw new MemberNotFoundError(input.memberId);
  }

  // 3. Optimistic concurrency check.
  if (existing.updatedAt.toISOString() !== input.expectedUpdatedAt) {
    throw new OptimisticConcurrencyError(input.memberId);
  }

  const now = new Date();

  // Build the set object — only include fields that were supplied.
  const setValues: Partial<typeof members.$inferInsert> = { updatedAt: now };
  if (input.displayName !== undefined) setValues.displayName = input.displayName;
  if (input.phone !== undefined) setValues.phone = input.phone;

  const [updated] = await tx
    .update(members)
    .set(setValues)
    .where(and(eq(members.id, input.memberId), eq(members.updatedAt, existing.updatedAt)))
    .returning();

  if (!updated) {
    throw new OptimisticConcurrencyError(input.memberId);
  }

  await writeAuditLog(tx, ctx, {
    action: "member.updated",
    subjectType: "member",
    subjectId: input.memberId,
    beforeJson: { displayName: existing.displayName, phone: existing.phone },
    afterJson: { displayName: updated.displayName, phone: updated.phone },
  });

  return { member: updated };
}
