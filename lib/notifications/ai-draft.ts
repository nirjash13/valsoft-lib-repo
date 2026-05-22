/**
 * AI-draft module for patron batch emails (REQ-07-05, REQ-07-06).
 *
 * INVARIANT (NFR-07-05 — PII isolation):
 *   `audienceSummary` and `intent` passed to this function MUST be aggregates only:
 *   counts, book titles, filter description, audience type. This function MUST NEVER
 *   receive or forward per-recipient names, email addresses, member IDs, or any other
 *   PII. Names are interpolated at send time (Builder C) via mustache tokens —
 *   NOT at draft time. The Vercel AI Gateway and Langfuse will log the prompt;
 *   PII in the prompt means PII in the logs — strictly forbidden.
 */

import { assertAiBudget } from "@/lib/ai/budget";
import { generateObjectViaGateway } from "@/lib/ai/gateway";
import { MODELS } from "@/lib/ai/routing";
import type { TenantId } from "@/lib/db/schema/_shared";
import { PatronEmailDraftSchema } from "@/lib/notifications/schemas";
import type { PatronEmailDraft } from "@/lib/notifications/schemas";

// ---------------------------------------------------------------------------
// Estimated cost per draft call (used for budget pre-check)
// Conservative estimate: ~1k input + ~500 output tokens on Sonnet.
// ---------------------------------------------------------------------------
const DRAFT_ESTIMATED_COST_USD = 0.01;

// ---------------------------------------------------------------------------
// Brand-voice instruction map
// ---------------------------------------------------------------------------
const BRAND_VOICE_INSTRUCTIONS: Record<string, string> = {
  warm: "Use a warm, friendly, encouraging tone. Address patrons as neighbours who love reading.",
  formal: "Use a formal, professional tone. Be concise and clear. Avoid contractions.",
  academic: "Use an academic, respectful tone appropriate for a scholarly community.",
};

const DEFAULT_BRAND_VOICE = "warm";

function getBrandVoiceInstruction(brandVoice: string | null): string {
  const voice = brandVoice ?? DEFAULT_BRAND_VOICE;
  return BRAND_VOICE_INSTRUCTIONS[voice] ?? BRAND_VOICE_INSTRUCTIONS[DEFAULT_BRAND_VOICE] ?? "";
}

// ---------------------------------------------------------------------------
// draftPatronEmail
// ---------------------------------------------------------------------------

export interface DraftPatronEmailParams {
  tenantId: TenantId;
  /**
   * The librarian's intent — what they want to communicate.
   * e.g. "Remind members their books are overdue and ask them to return or renew."
   * Must NOT contain per-recipient names or emails.
   */
  intent: string;
  /**
   * Aggregate description of the audience — counts, filter type, sample book titles.
   * e.g. "12 members with books overdue 7+ days. Sample titles: The Great Gatsby, 1984."
   * Must NOT contain per-recipient names or emails.
   */
  audienceSummary: string;
  /**
   * The tenant's brand voice setting ("warm" | "formal" | "academic" | null).
   * Null → defaults to "warm".
   */
  brandVoice: string | null;
}

/**
 * Drafts a patron batch email using the AI model.
 *
 * @returns A structured `PatronEmailDraft` with subject, body_markdown, and required_fields.
 *
 * @throws AiBudgetNotConfiguredError if the tenant has no AI budget configured.
 * @throws AiBudgetExceededError if the estimated call cost exceeds the tenant's cap.
 * @throws AiGatewayNotConfiguredError if AI_GATEWAY_API_KEY is not set.
 * @throws ZodError if the model returns output that does not match PatronEmailDraftSchema.
 */
export async function draftPatronEmail(params: DraftPatronEmailParams): Promise<PatronEmailDraft> {
  // Budget pre-check MUST come before any gateway call.
  await assertAiBudget(params.tenantId, DRAFT_ESTIMATED_COST_USD);

  const brandVoiceInstruction = getBrandVoiceInstruction(params.brandVoice);

  const system = `You draft warm, concise patron emails for a library.

${brandVoiceInstruction}

MUSTACHE TOKENS: Use these placeholders for any per-recipient values:
  {{book_title}}      — the title of the patron's specific book
  {{due_date}}        — the due date of the patron's loan
  {{pickup_window}}   — the date/time by which the patron must pick up their held book

IMPORTANT: Do NOT include actual patron names or email addresses in the email body.
Per-recipient data is merged at send time — use only the tokens above for personalization.

REQUIRED FIELDS: After writing the email, set required_fields truthfully:
  has_book_title:    true  if and only if {{book_title}} appears in body_markdown
  has_due_date:      true  if and only if {{due_date}} appears in body_markdown
  has_pickup_window: true  if and only if {{pickup_window}} appears in body_markdown

Write a subject (max 120 chars) and a body in Markdown (max 4000 chars).`;

  const prompt = `Librarian intent: ${params.intent}

Audience summary (aggregate only — no names or emails): ${params.audienceSummary}`;

  const result = await generateObjectViaGateway({
    model: MODELS.readersAdvisor,
    schema: PatronEmailDraftSchema,
    system,
    prompt,
    tenantId: params.tenantId,
    feature: "patron_email_draft",
  });
  return result.object;
}
