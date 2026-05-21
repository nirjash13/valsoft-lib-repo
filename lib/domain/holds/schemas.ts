import { z } from "zod";

export const PlaceHoldSchema = z.object({
  bookId: z.string().uuid(),
  memberId: z.string().uuid(),
});
export type PlaceHoldInput = z.infer<typeof PlaceHoldSchema>;

export const CancelHoldSchema = z.object({
  holdId: z.string().uuid(),
});
export type CancelHoldInput = z.infer<typeof CancelHoldSchema>;
