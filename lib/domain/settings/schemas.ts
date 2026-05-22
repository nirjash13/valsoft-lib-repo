/**
 * Zod schemas for the settings domain.
 *
 * US-06: brand voice selector — warm / formal / academic.
 * Values must match exactly what ai-draft.ts BRAND_VOICE_INSTRUCTIONS maps.
 */

import { z } from "zod";

export const BrandVoiceSchema = z.enum(["warm", "formal", "academic"]);
export type BrandVoice = z.infer<typeof BrandVoiceSchema>;

export const UpdateBrandVoiceSchema = z.object({
  brandVoice: BrandVoiceSchema,
});
export type UpdateBrandVoiceInput = z.infer<typeof UpdateBrandVoiceSchema>;
