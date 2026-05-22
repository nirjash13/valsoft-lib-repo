/**
 * Zod schemas for the settings domain.
 *
 * US-06: brand voice selector — warm / formal / academic.
 * Values must match exactly what ai-draft.ts BRAND_VOICE_INSTRUCTIONS maps.
 *
 * US-05: public catalog toggle — publicCatalogEnabled boolean.
 */

import { z } from "zod";

export const BrandVoiceSchema = z.enum(["warm", "formal", "academic"]);
export type BrandVoice = z.infer<typeof BrandVoiceSchema>;

export const UpdateBrandVoiceSchema = z.object({
  brandVoice: BrandVoiceSchema,
});
export type UpdateBrandVoiceInput = z.infer<typeof UpdateBrandVoiceSchema>;

export const UpdatePublicCatalogSchema = z.object({
  /** Whether the public catalog is enabled for this tenant (US-05, REQ-09-05). */
  enabled: z.boolean(),
});
export type UpdatePublicCatalogInput = z.infer<typeof UpdatePublicCatalogSchema>;
