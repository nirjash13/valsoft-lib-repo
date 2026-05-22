/**
 * updateMemberRole — tenant_admin promotes or demotes a member's role.
 *
 * Guards:
 *   1. Member must exist in this tenant.
 *   2. Optimistic concurrency: expectedUpdatedAt must match stored updatedAt.
 *   3. Cannot remove the last tenant_admin from a tenant (LastTenantAdminError).
 *
 * The "last tenant_admin" check counts active/non-deleted tenant_admin members
 * whose role would change. If the target is the only tenant_admin and the new
 * role is not tenant_admin, the operation is refused.
 *
 * Audit: writes 'member.role_changed' inside the same transaction.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import { members } from "@/lib/db/schema/members";
import type { Member } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { OptimisticConcurrencyError } from "@/lib/domain/books/errors";
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { LastTenantAdminError, MemberNotFoundError } from "./errors";
import type { UpdateMemberRoleInput } from "./schemas";

export interface UpdateMemberRoleResult {
  member: Member;
}

/**
 * @throws MemberNotFoundError          if memberId does not exist.
 * @throws OptimisticConcurrencyError   if expectedUpdatedAt does not match.
 * @throws LastTenantAdminError         if the operation would leave zero tenant_admins.
 */
export async function updateMemberRole(
  tx: TxClient,
  ctx: TenantCtx,
  input: UpdateMemberRoleInput,
): Promise<UpdateMemberRoleResult> {
  // 1. Read current member state.
  const [existing] = await tx.select().from(members).where(eq(members.id, input.memberId));

  if (!existing) {
    throw new MemberNotFoundError(input.memberId);
  }

  // 2. Optimistic concurrency check.
  if (existing.updatedAt.toISOString() !== input.expectedUpdatedAt) {
    throw new OptimisticConcurrencyError(input.memberId);
  }

  // 3. Last-tenant_admin invariant:
  //    If the current role is tenant_admin and the new role is NOT tenant_admin,
  //    we must verify at least one other non-deleted tenant_admin remains.
  if (existing.role === "tenant_admin" && input.role !== "tenant_admin") {
    const [row] = await tx
      .select({ adminCount: count() })
      .from(members)
      .where(
        and(
          eq(members.tenantId, ctx.tenantId),
          eq(members.role, "tenant_admin"),
          isNull(members.deletedAt),
          ne(members.id, input.memberId), // exclude the member being demoted
        ),
      );

    const remaining = row?.adminCount ?? 0;

    if (remaining === 0) {
      throw new LastTenantAdminError(ctx.tenantId);
    }
  }

  const now = new Date();

  const [updated] = await tx
    .update(members)
    .set({
      role: input.role,
      updatedAt: now,
    })
    .where(and(eq(members.id, input.memberId), eq(members.updatedAt, existing.updatedAt)))
    .returning();

  if (!updated) {
    throw new OptimisticConcurrencyError(input.memberId);
  }

  await writeAuditLog(tx, ctx, {
    action: "member.role_changed",
    subjectType: "member",
    subjectId: input.memberId,
    beforeJson: { role: existing.role },
    afterJson: { role: updated.role },
  });

  return { member: updated };
}
