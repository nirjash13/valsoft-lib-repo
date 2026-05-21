import { z } from "zod";

export const BorrowBookSchema = z.object({
  bookId: z.string().uuid(),
  memberId: z.string().uuid(),
});
export type BorrowBookInput = z.infer<typeof BorrowBookSchema>;

export const ReturnBookSchema = z.object({
  loanId: z.string().uuid(),
});
export type ReturnBookInput = z.infer<typeof ReturnBookSchema>;

export const RenewLoanSchema = z.object({
  loanId: z.string().uuid(),
  /** ISO-8601 datetime string matching the loan's current updatedAt — optimistic concurrency token. */
  expectedUpdatedAt: z.string().datetime(),
});
export type RenewLoanInput = z.infer<typeof RenewLoanSchema>;
