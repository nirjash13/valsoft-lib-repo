/**
 * place_hold tool — places a hold reservation for the authenticated member.
 *
 * Returns a structured result in all cases — never throws out of the tool
 * so the model can relay a friendly explanation to the member.
 */

import type { AppAbility } from "@/lib/auth/ability";
import type { TenantCtx } from "@/lib/db/with-tenant-tx";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { HoldAlreadyExistsError, HoldNotPlaceableError } from "@/lib/domain/holds/errors";
import { placeHold } from "@/lib/domain/holds/place-hold";
import { MemberNotActiveError } from "@/lib/domain/loans/errors";
import { tool, zodSchema } from "ai";
import { z } from "zod";

export type PlaceHoldResult =
  | { placed: true; queue_position: number }
  | { placed: false; reason: string };

const PlaceHoldArgsSchema = z.object({
  book_id: z.string().uuid().describe("The book UUID to place a hold on"),
});

type PlaceHoldArgs = z.infer<typeof PlaceHoldArgsSchema>;

export const placeHoldTool = (ctx: TenantCtx, ability: AppAbility, memberId: string | null) =>
  tool<PlaceHoldArgs, PlaceHoldResult>({
    description:
      "Place a hold reservation on a book for the current member. Only works when the book is currently on loan.",
    inputSchema: zodSchema(PlaceHoldArgsSchema),
    execute: async ({ book_id }): Promise<PlaceHoldResult> => {
      if (!ability.can("create", "Hold")) {
        return { placed: false, reason: "You do not have permission to place holds." };
      }

      if (!memberId) {
        return {
          placed: false,
          reason:
            "Your account is not linked to a library member record. Please contact the library.",
        };
      }

      try {
        const result = await withTenantTx(ctx, (tx, tenantCtx) =>
          placeHold(tx, tenantCtx, { bookId: book_id, memberId }),
        );
        return { placed: true, queue_position: result.position };
      } catch (err) {
        if (err instanceof HoldAlreadyExistsError) {
          return { placed: false, reason: "You already have an active hold on this book." };
        }
        if (err instanceof HoldNotPlaceableError) {
          return {
            placed: false,
            reason:
              "This book is not currently on loan — you can borrow it directly from the library.",
          };
        }
        if (err instanceof MemberNotActiveError) {
          return {
            placed: false,
            reason: "Your membership is not currently active. Please contact the library.",
          };
        }
        throw err;
      }
    },
  });
