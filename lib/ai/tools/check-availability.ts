/**
 * check_availability tool — reports whether a book is currently on loan
 * and how many members are in the hold queue.
 */

import type { TenantCtx } from "@/lib/db/with-tenant-tx";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { listHoldsByBook } from "@/lib/domain/holds/list-holds-by-book";
import { hasActiveLoan } from "@/lib/domain/loans/has-active-loan";
import { tool, zodSchema } from "ai";
import { z } from "zod";

export interface AvailabilityResult {
  on_loan: boolean;
  holds_queue_length: number;
}

const CheckAvailabilityArgsSchema = z.object({
  book_id: z.string().uuid().describe("The book UUID"),
});

type CheckAvailabilityArgs = z.infer<typeof CheckAvailabilityArgsSchema>;

export const checkAvailabilityTool = (ctx: TenantCtx) =>
  tool<CheckAvailabilityArgs, AvailabilityResult>({
    description: "Check whether a book is currently on loan and how many holds are in the queue.",
    inputSchema: zodSchema(CheckAvailabilityArgsSchema),
    execute: async ({ book_id }): Promise<AvailabilityResult> => {
      const [on_loan, holds] = await withTenantTx(ctx, async (tx, tenantCtx) =>
        Promise.all([hasActiveLoan(tx, book_id), listHoldsByBook(tx, tenantCtx, book_id)]),
      );

      return {
        on_loan,
        holds_queue_length: holds.length,
      };
    },
  });
