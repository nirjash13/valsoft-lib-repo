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
      await cancelHold(tx, txCtx, parsedInput);
    });

    const tenantId = ctx.tenantCtx.tenantId;
    revalidateTag(`tenant:${tenantId}:holds`, "default");
    revalidateTag(`tenant:${tenantId}:books`, "default");

    return { cancelled: true };
  });
