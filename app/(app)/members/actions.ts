/**
 * Member management Server Actions — the command bus for Spec 04.
 *
 * Self-signup is intentionally NOT here — it is exposed via a public Route Handler
 * (app/api/members/signup/route.ts) because it is called without an authenticated
 * session. All actions below require auth and a CASL permission check.
 *
 * CASL permission mapping:
 *   approveMemberAction     → member:update  (librarian + tenant_admin)
 *   rejectMemberAction      → member:update  (librarian + tenant_admin)
 *   updateMemberAction      → member:update  (any authenticated member — ownership
 *                                            check is inside the domain function)
 *   updateMemberRoleAction  → member:manage  (tenant_admin only)
 */

"use server";

import { writeAuditLog } from "@/lib/audit/audit-log";
import { actionClient } from "@/lib/auth/safe-action";
import { members } from "@/lib/db/schema/members";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { OptimisticConcurrencyError } from "@/lib/domain/books/errors";
import { approveMember } from "@/lib/domain/members/approve-member";
import { canBorrow } from "@/lib/domain/members/can-borrow";
import { LastTenantAdminError, MemberNotFoundError } from "@/lib/domain/members/errors";
import { getMemberByUserId } from "@/lib/domain/members/get-member-by-user-id";
import { rejectMember } from "@/lib/domain/members/reject-member";
import {
  ApproveMemberSchema,
  RejectMemberSchema,
  UpdateMemberAdminSchema,
  UpdateMemberRoleSchema,
  UpdateMemberSchema,
} from "@/lib/domain/members/schemas";
import { searchMembers } from "@/lib/domain/members/search-members";
import { updateMember } from "@/lib/domain/members/update-member";
import { updateMemberRole } from "@/lib/domain/members/update-member-role";
import { onMemberApproved, onMemberRejected } from "@/lib/notifications/triggers";
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { z } from "zod";

// ---------------------------------------------------------------------------
// approveMemberAction — member:update (librarian + tenant_admin)
// ---------------------------------------------------------------------------

/**
 * Approves a pending member signup. Transitions status pending → active.
 * The approving librarian/admin's member row is resolved from their Auth0 sub
 * and used as the `approvedBy` FK.
 *
 * Post-commit side effect: sends a welcome email via onMemberApproved().
 *
 * @permission member:update
 */
export const approveMemberAction = actionClient
  .schema(ApproveMemberSchema)
  .metadata({ permission: "member:update" })
  .action(async ({ parsedInput, ctx }) => {
    const result = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      // Resolve the caller's own member row to use as approvedBy.
      // If the caller has no linked member row (e.g., a service account), use
      // their Auth0 sub as a fallback string stored in approvedBy.
      const callerMember = await getMemberByUserId(tx, txCtx, ctx.session.sub);
      const callerMemberId = callerMember?.id ?? ctx.session.sub;

      return approveMember(tx, txCtx, parsedInput, callerMemberId);
    });

    revalidateTag(`tenant:${ctx.tenantCtx.tenantId}:members`, "default");

    // Post-commit: send welcome email. Must not fail the approve action.
    try {
      await onMemberApproved({ tenantId: ctx.tenantCtx.tenantId, memberId: result.member.id });
    } catch (err) {
      console.error("[approveMemberAction] onMemberApproved failed:", err);
    }

    return { memberId: result.member.id, status: result.member.status };
  });

// ---------------------------------------------------------------------------
// rejectMemberAction — member:update (librarian + tenant_admin)
// ---------------------------------------------------------------------------

/**
 * Rejects a pending member signup with a mandatory reason.
 * Transitions status pending → rejected.
 *
 * Post-commit side effect: sends a rejection email via onMemberRejected().
 *
 * @permission member:update
 */
export const rejectMemberAction = actionClient
  .schema(RejectMemberSchema)
  .metadata({ permission: "member:update" })
  .action(async ({ parsedInput, ctx }) => {
    const result = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      const callerMember = await getMemberByUserId(tx, txCtx, ctx.session.sub);
      const callerMemberId = callerMember?.id ?? ctx.session.sub;

      return rejectMember(tx, txCtx, parsedInput, callerMemberId);
    });

    revalidateTag(`tenant:${ctx.tenantCtx.tenantId}:members`, "default");

    // Post-commit: send rejection email. Must not fail the reject action.
    try {
      await onMemberRejected({ tenantId: ctx.tenantCtx.tenantId, memberId: result.member.id });
    } catch (err) {
      console.error("[rejectMemberAction] onMemberRejected failed:", err);
    }

    return { memberId: result.member.id, status: result.member.status };
  });

// ---------------------------------------------------------------------------
// updateMemberAction — member:update (any authenticated caller, ownership enforced)
// ---------------------------------------------------------------------------

/**
 * Member self-updates their own profile (displayName, phone).
 * Ownership is enforced in the domain function: callerMemberId must equal input.memberId.
 * Staff updating another member's profile is a Run B UI concern (admin edit form).
 *
 * @permission member:update
 */
export const updateMemberAction = actionClient
  .schema(UpdateMemberSchema)
  .metadata({ permission: "member:update" })
  .action(async ({ parsedInput, ctx }) => {
    const result = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      // Resolve the caller's member row for the ownership check.
      const callerMember = await getMemberByUserId(tx, txCtx, ctx.session.sub);
      if (!callerMember) {
        throw new MemberNotFoundError(ctx.session.sub);
      }

      return updateMember(tx, txCtx, parsedInput, callerMember.id);
    });

    revalidateTag(`tenant:${ctx.tenantCtx.tenantId}:members`, "default");
    return { memberId: result.member.id };
  });

// ---------------------------------------------------------------------------
// updateMemberRoleAction — member:manage (tenant_admin only)
// ---------------------------------------------------------------------------

/**
 * Promotes or demotes a member's role within the tenant.
 * Refuses to remove the last tenant_admin (LastTenantAdminError → 409).
 *
 * @permission member:manage
 */
export const updateMemberRoleAction = actionClient
  .schema(UpdateMemberRoleSchema)
  .metadata({ permission: "member:manage" })
  .action(async ({ parsedInput, ctx }) => {
    const result = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      return updateMemberRole(tx, txCtx, parsedInput);
    });

    revalidateTag(`tenant:${ctx.tenantCtx.tenantId}:members`, "default");
    return { memberId: result.member.id, role: result.member.role };
  });

// ---------------------------------------------------------------------------
// updateMemberAdminAction — member:manage (tenant_admin only)
// ---------------------------------------------------------------------------

/**
 * Admin updates another member's profile fields, status, and/or canBorrow.
 * This is distinct from updateMemberAction (self-edit with ownership check).
 *
 * Updatable fields: displayName, phone, status (active|inactive|suspended).
 * canBorrow is derived from status via the canBorrow() pure helper.
 *
 * @permission member:manage
 */
export const updateMemberAdminAction = actionClient
  .schema(UpdateMemberAdminSchema)
  .metadata({ permission: "member:manage" })
  .action(async ({ parsedInput, ctx }) => {
    const result = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      const [existing] = await tx
        .select()
        .from(members)
        .where(eq(members.id, parsedInput.memberId));

      if (!existing) {
        throw new MemberNotFoundError(parsedInput.memberId);
      }

      if (existing.updatedAt.toISOString() !== parsedInput.expectedUpdatedAt) {
        throw new OptimisticConcurrencyError(parsedInput.memberId);
      }

      // H3: Last-admin invariant on status change.
      // If the target member is a tenant_admin and the new status is not "active",
      // refuse if they are the sole remaining active tenant_admin.
      const newStatus = parsedInput.status ?? existing.status;
      if (
        existing.role === "tenant_admin" &&
        existing.status === "active" &&
        newStatus !== "active"
      ) {
        const [row] = await tx
          .select({ adminCount: count() })
          .from(members)
          .where(
            and(
              eq(members.tenantId, txCtx.tenantId),
              eq(members.role, "tenant_admin"),
              eq(members.status, "active"),
              isNull(members.deletedAt),
              ne(members.id, parsedInput.memberId),
            ),
          );

        const remaining = row?.adminCount ?? 0;
        if (remaining === 0) {
          throw new LastTenantAdminError(txCtx.tenantId);
        }
      }

      const now = new Date();

      const setValues: Partial<typeof members.$inferInsert> = {
        updatedAt: now,
        status: newStatus,
        canBorrow: canBorrow({ status: newStatus }),
      };

      if (parsedInput.displayName !== undefined) setValues.displayName = parsedInput.displayName;
      if (parsedInput.phone !== undefined) setValues.phone = parsedInput.phone;

      const [updated] = await tx
        .update(members)
        .set(setValues)
        .where(and(eq(members.id, parsedInput.memberId), eq(members.updatedAt, existing.updatedAt)))
        .returning();

      if (!updated) {
        throw new OptimisticConcurrencyError(parsedInput.memberId);
      }

      await writeAuditLog(tx, txCtx, {
        action: "member.updated",
        subjectType: "member",
        subjectId: parsedInput.memberId,
        beforeJson: {
          status: existing.status,
          canBorrow: existing.canBorrow,
          displayName: existing.displayName,
          phone: existing.phone,
        },
        afterJson: {
          status: updated.status,
          canBorrow: updated.canBorrow,
          displayName: updated.displayName,
          phone: updated.phone,
        },
      });

      return { member: updated };
    });

    revalidateTag(`tenant:${ctx.tenantCtx.tenantId}:members`, "default");
    return {
      memberId: result.member.id,
      status: result.member.status,
      updatedAt: result.member.updatedAt.toISOString(),
    };
  });

// ---------------------------------------------------------------------------
// searchMembersAction — member:read (librarian + tenant_admin)
// ---------------------------------------------------------------------------

/**
 * Quick member lookup for the checkout dialog.
 * Returns up to 10 active members matching the query (name or email ILIKE).
 * When query is empty, returns the 10 most recently created active members.
 *
 * @permission member:read
 */
export const searchMembersAction = actionClient
  .schema(z.object({ query: z.string().max(100) }))
  .metadata({ permission: "member:read" })
  .action(async ({ parsedInput, ctx }) => {
    const results = await withTenantTx(ctx.tenantCtx, (tx, txCtx) =>
      searchMembers(tx, txCtx, parsedInput.query),
    );
    return { members: results };
  });
