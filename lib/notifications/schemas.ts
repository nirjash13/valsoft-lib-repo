/**
 * Zod schemas for the notifications domain — AI draft, batch email, audience filter.
 *
 * Single source of truth used at three boundaries:
 *   1. Server Action input validation (next-safe-action .schema(...))
 *   2. AI structured-output schema (`generateObjectViaGateway` → `generateObject`)
 *   3. Client form parsing (react-hook-form + zodResolver)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// PatronEmailDraftSchema — REQ-07-06
//
// Structured output produced by the AI draft endpoint. `required_fields` reflects
// which mustache tokens the model used in `body_markdown`; the draft-validation
// layer checks token presence against these flags before allowing send.
// ---------------------------------------------------------------------------

export const PatronEmailDraftSchema = z.object({
  subject: z
    .string()
    .min(1, "Subject is required")
    .max(120, "Subject must be 120 characters or less"),
  body_markdown: z
    .string()
    .min(1, "Body is required")
    .max(4000, "Body must be 4000 characters or less"),
  required_fields: z.object({
    has_book_title: z.boolean(),
    has_due_date: z.boolean(),
    has_pickup_window: z.boolean(),
  }),
});

export type PatronEmailDraft = z.infer<typeof PatronEmailDraftSchema>;

// ---------------------------------------------------------------------------
// AudienceFilterSchema — audience segments available for batch emails
// ---------------------------------------------------------------------------

export const AudienceFilterSchema = z.enum([
  "overdue_7d",
  "overdue_5d",
  "due_this_week",
  "holds_ready",
]);

export type AudienceFilter = z.infer<typeof AudienceFilterSchema>;

// ---------------------------------------------------------------------------
// DraftBatchEmailSchema — Server Action input for AI-draft step (REQ-07-05)
// ---------------------------------------------------------------------------

export const DraftBatchEmailSchema = z.object({
  audienceFilter: AudienceFilterSchema,
  intent: z.string().min(1, "Intent is required").max(500, "Intent must be 500 characters or less"),
});

export type DraftBatchEmailInput = z.infer<typeof DraftBatchEmailSchema>;

// ---------------------------------------------------------------------------
// SendBatchEmailSchema — Server Action input for the confirmed send step
// ---------------------------------------------------------------------------

export const SendBatchEmailSchema = z.object({
  audienceFilter: AudienceFilterSchema,
  subject: z
    .string()
    .min(1, "Subject is required")
    .max(120, "Subject must be 120 characters or less"),
  bodyMarkdown: z
    .string()
    .min(1, "Body is required")
    .max(4000, "Body must be 4000 characters or less"),
  aiDrafted: z.boolean(),
  /**
   * The recipient count at draft time (from draftBatchEmailAction).
   * Compared against the send-time audience count to detect audience drift
   * (§7 edge case: two librarians composing concurrently).
   * Null means the email was manually composed without a prior AI draft step.
   */
  draftedRecipientCount: z.number().int().nonnegative().nullable(),
});

export type SendBatchEmailInput = z.infer<typeof SendBatchEmailSchema>;
