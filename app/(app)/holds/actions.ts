/**
 * Hold management Server Actions — the command bus for Spec 03 holds queue.
 *
 * Pattern: actionClient.schema(…).metadata({ permission }).action(async ({ parsedInput, ctx }) =>
 *   withTenantTx(ctx.tenantCtx, async (tx, txCtx) => domainFn(tx, txCtx, parsedInput))
 * )
 */

"use server";

import { actionClient } from "@/lib/auth/safe-action";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { cancelHold } from "@/lib/domain/holds/cancel-hold";
import { placeHold } from "@/lib/domain/holds/place-hold";
import { CancelHoldSchema, PlaceHoldSchema } from "@/lib/domain/holds/schemas";
import { getMemberByUserId } from "@/lib/domain/members/get-member-by-user-id";
import { revalidateTag } from "next/cache";

// ---------------------------------------------------------------------------
// placeHoldAction — hold:create
// ---------------------------------------------------------------------------

/**
 * Places a hold reservation for (bookId, memberId).
 * Refused if: book has no active loan (borrow it directly), member is not active,
 * or member already has a hold on this book.
 *
 * @permission hold:create
 */
export const placeHoldAction = actionClient
  .schema(PlaceHoldSchema)
  .metadata({ permission: "hold:create" })
  .action(async ({ parsedInput, ctx }) => {
    const result = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      return placeHold(tx, txCtx, parsedInput);
    });

    const tenantId = ctx.tenantCtx.tenantId;
    revalidateTag(`tenant:${tenantId}:holds`, "default");
    revalidateTag(`tenant:${tenantId}:books`, "default");

    return { holdId: result.hold.id, position: result.position };
  });

// ---------------------------------------------------------------------------
// cancelHoldAction — hold:delete
// ---------------------------------------------------------------------------

/**
 * Cancels an active (queued or ready) hold.
 * Members cancel their own; librarians cancel any in the tenant.
 * Returns 404 if the hold is not found or already expired/cancelled.
 *
 * @permission hold:delete
 */
export const cancelHoldAction = actionClient
  .schema(CancelHoldSchema)
  .metadata({ permission: "hold:delete" })
  .action(async ({ parsedInput, ctx }) => {
    await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      // Ownership enforcement: librarians and admins can cancel any hold in the tenant.
      // Members may only cancel their own holds — pass callerMemberId so the domain
      // function can verify ownership (M-5 / H-1 fix).
      // `hold:manage` is granted only to tenant_admin; librarians have `hold:delete`
      // but also `loan:checkin` which members lack. Easiest stable check: if the caller
      // can "checkin" a Loan they are staff; otherwise they are a member-tier caller.
      const isStaff = ctx.ability.can("checkin", "Loan");
      let callerMemberId: string | undefined;
      if (!isStaff) {
        // Member caller — resolve their member record so we can enforce ownership.
        // getMemberByUserId is a Spec 04 stub (returns null until auth0_user_id is linked).
        // When null, no memberId is passed and the ownership check is skipped for
        // unlinked accounts. Unlinked members cannot see their holds (holds page shows
        // MemberAccountPending), so this does not open a privilege-escalation window.
        const member = await getMemberByUserId(tx, txCtx, ctx.session.sub);
        callerMemberId = member?.id;
      }

      if (callerMemberId !== undefined) {
        await cancelHold(tx, txCtx, { holdId: parsedInput.holdId, callerMemberId });
      } else {
        await cancelHold(tx, txCtx, { holdId: parsedInput.holdId });
      }
    });

    const tenantId = ctx.tenantCtx.tenantId;
    revalidateTag(`tenant:${tenantId}:holds`, "default");
    revalidateTag(`tenant:${tenantId}:books`, "default");

    return { cancelled: true };
  });
