/**
 * POST /api/chat/stream — Reader's Advisor streaming endpoint (Spec 06).
 *
 * Auth:          requires a valid session (getSession → 401).
 * Kill switch:   isFeatureEnabled("readers_advisor") → 404 if off (REQ-06-10).
 * Budget guard:  assertAiBudget → 402 if quota reached (REQ-06-07).
 * Tenant scoped: all DB access through withTenantTx.
 * AI gateway:    streamTextViaGateway only (no direct SDK imports).
 *
 * Request body (sent by @ai-sdk/react useChat):
 *   { messages: UIMessage[], pageContext?: string }
 *
 * Response: UIMessage stream (toUIMessageStreamResponse()).
 */

export const runtime = "nodejs"; // pgvector + pg require Node; NOT Edge.

import { AiBudgetExceededError, AiBudgetNotConfiguredError, assertAiBudget } from "@/lib/ai/budget";
import { AiGatewayNotConfiguredError, streamTextViaGateway } from "@/lib/ai/gateway";
import { loadPromptByName } from "@/lib/ai/prompts/load-prompt";
import { MODELS } from "@/lib/ai/routing";
import { buildAdvisorTools } from "@/lib/ai/tools/index";
import { buildAbility } from "@/lib/auth/ability";
import { getSession, sessionToTenantCtx } from "@/lib/auth/session";
import type { TenantId } from "@/lib/db/schema/_shared";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { appendMessage } from "@/lib/domain/chat/append-message";
import { extractBookRefs } from "@/lib/domain/chat/book-refs";
import { getOrCreateThread } from "@/lib/domain/chat/get-or-create-thread";
import { logRefusal } from "@/lib/domain/chat/log-refusal";
import { normalizePageContext } from "@/lib/domain/chat/page-context";
import { recordUsage } from "@/lib/domain/chat/record-usage";
import { isRefusalText } from "@/lib/domain/chat/refusal";
import { ChatRequestSchema } from "@/lib/domain/chat/schemas";
import { getMemberByUserId } from "@/lib/domain/members/get-member-by-user-id";
import { isFeatureEnabled } from "@/lib/flags";
import { problem } from "@/lib/http/problem";
import { convertToModelMessages, safeValidateUIMessages } from "ai";

// Load the system prompt once at module init (tiny file, sync read is fine).
const ADVISOR_PROMPT = loadPromptByName("readers-advisor.v1.md");

export async function POST(req: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // Step 1: Auth boundary
  // ---------------------------------------------------------------------------
  const session = await getSession();
  if (!session) {
    return problem(401, "Unauthorized", "A valid session is required", "UNAUTHORIZED");
  }

  // ---------------------------------------------------------------------------
  // Step 2: Kill switch — 404 (not 503) per REQ-06-10
  // ---------------------------------------------------------------------------
  if (!(await isFeatureEnabled("readers_advisor"))) {
    return problem(404, "Not Found");
  }

  // ---------------------------------------------------------------------------
  // Step 3: Parse body
  // ---------------------------------------------------------------------------
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return problem(400, "Bad Request", "Request body must be valid JSON", "INVALID_JSON");
  }

  // messages is passed through to convertToModelMessages; pageContext parsed by our schema.
  const bodyObj = rawBody as Record<string, unknown>;
  const parsedCtx = ChatRequestSchema.safeParse({ pageContext: bodyObj.pageContext });
  if (!parsedCtx.success) {
    return problem(
      422,
      "Unprocessable Entity",
      parsedCtx.error.issues.map((i) => i.message).join("; "),
      "VALIDATION_ERROR",
    );
  }

  // Validate the messages array shape server-side (REQ-06-04 / spec §9).
  // safeValidateUIMessages returns { success, data } or { success, error } — never throws.
  const messagesValidation = await safeValidateUIMessages({ messages: bodyObj.messages });
  if (!messagesValidation.success) {
    return problem(422, "Invalid request", "Malformed chat messages.", "INVALID_MESSAGES");
  }

  // Spec §9: soft-truncate any user-message text content to 1000 chars server-side.
  // Do NOT reject — truncation is the specified behavior for over-long input.
  const MAX_USER_MSG_CHARS = 1000;
  const uiMessages = messagesValidation.data.map((msg) => {
    if (msg.role !== "user") return msg;
    return {
      ...msg,
      parts: msg.parts.map((part) => {
        if (part.type !== "text") return part;
        const text = part.text;
        return text.length > MAX_USER_MSG_CHARS
          ? { ...part, text: text.slice(0, MAX_USER_MSG_CHARS) }
          : part;
      }),
    };
  });

  // ---------------------------------------------------------------------------
  // Step 4: Tenant context + ability
  // ---------------------------------------------------------------------------
  const tenantCtx = await sessionToTenantCtx(session);
  const ability = buildAbility(session.roles);

  // ---------------------------------------------------------------------------
  // Step 5: Budget guard
  // ---------------------------------------------------------------------------
  // Cast: tenantCtx.tenantId is plain string; assertAiBudget requires branded TenantId.
  // The value originates from a verified JWT org_id → DB lookup — safe to brand here.
  const brandedTenantId = tenantCtx.tenantId as TenantId;
  try {
    await assertAiBudget(brandedTenantId, 0.02);
  } catch (err) {
    if (err instanceof AiBudgetExceededError || err instanceof AiBudgetNotConfiguredError) {
      return problem(
        402,
        "AI quota reached",
        "AI quota reached this month — please try again next month or contact your library admin.",
        "AI_BUDGET_EXCEEDED",
      );
    }
    throw err;
  }

  // ---------------------------------------------------------------------------
  // Step 6: Resolve member (null = no persistence; chat still works ephemerally)
  // ---------------------------------------------------------------------------
  let memberId: string | null = null;
  try {
    const member = await withTenantTx(tenantCtx, (tx, ctx) =>
      getMemberByUserId(tx, ctx, session.sub),
    );
    memberId = member?.id ?? null;
  } catch {
    // Non-fatal: proceed without member (ephemeral session).
    memberId = null;
  }

  // ---------------------------------------------------------------------------
  // Step 7: Get or create thread (only if we have a member)
  // ---------------------------------------------------------------------------
  let threadId: string | null = null;
  if (memberId !== null) {
    try {
      const pageContext = normalizePageContext(parsedCtx.data.pageContext);
      const thread = await withTenantTx(tenantCtx, (tx, ctx) =>
        getOrCreateThread(tx, ctx, { memberId: memberId as string, pageContext }),
      );
      threadId = thread.id;
    } catch (threadErr) {
      // Non-fatal: lose persistence, keep streaming. Log so operators see degradation.
      console.error(
        "[chat/stream] getOrCreateThread failed — falling back to ephemeral session:",
        threadErr,
      );
      threadId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Step 8: Load system prompt + convert messages
  // ---------------------------------------------------------------------------
  const system = ADVISOR_PROMPT.body;
  const modelMessages = await convertToModelMessages(uiMessages);

  // Extract the verbatim last user message for refusal logging.
  const lastUserMsg = [...uiMessages].reverse().find(
    // biome-ignore lint/suspicious/noExplicitAny: third-party shape boundary
    (m: any) => m.role === "user",
  );
  // biome-ignore lint/suspicious/noExplicitAny: third-party shape boundary
  const lastUserText: string = extractUserText(lastUserMsg as any);

  // ---------------------------------------------------------------------------
  // Step 9 + 11: Call streamTextViaGateway + return stream
  // ---------------------------------------------------------------------------
  let result: ReturnType<typeof streamTextViaGateway>;

  try {
    result = streamTextViaGateway({
      model: MODELS.readersAdvisor,
      system,
      messages: modelMessages,
      tools: buildAdvisorTools({ ctx: tenantCtx, ability, memberId }),
      tenantId: brandedTenantId,
      feature: "readers_advisor",
      onFinish: async (event) => {
        // onFinish failures must NOT crash the stream — wrap and log.
        try {
          await handleFinish({
            event,
            tenantCtx,
            threadId,
            memberId,
            lastUserText,
            promptVersion: ADVISOR_PROMPT.version,
          });
        } catch (finishErr) {
          console.error("[chat/stream] onFinish persistence error:", finishErr);
        }
      },
    });
  } catch (err) {
    // AiGatewayNotConfiguredError or any throw BEFORE the stream starts → 503.
    if (err instanceof AiGatewayNotConfiguredError || isGatewayError(err)) {
      return problem(
        503,
        "AI temporarily unavailable",
        "Sorry, the reading advisor is temporarily unavailable. Please try again in a minute.",
        "AI_UNAVAILABLE",
      );
    }
    throw err;
  }

  // ---------------------------------------------------------------------------
  // Step 11: Return streaming response
  // ---------------------------------------------------------------------------
  // streamText (ai v6) is lazy — it returns its result object synchronously and
  // only contacts the gateway when the stream is consumed. A gateway 5xx or
  // network failure therefore surfaces INSIDE the stream, not as a thrown error.
  // The try/catch above only catches AiGatewayNotConfiguredError (pre-stream).
  // onError intercepts mid-stream failures and returns the REQ-11-08 friendly copy
  // instead of the SDK default "An error occurred." (REQ-11-08).
  return result.toUIMessageStreamResponse({
    onError: () =>
      "Sorry, the reading advisor is temporarily unavailable. Please try again in a minute.",
  });
}

// ---------------------------------------------------------------------------
// handleFinish — persist messages, usage, and refusal on stream completion.
// ---------------------------------------------------------------------------

interface HandleFinishOptions {
  // biome-ignore lint/suspicious/noExplicitAny: ai v6 OnFinishEvent — typed at call site
  event: any;
  tenantCtx: { tenantId: string; userId: string };
  threadId: string | null;
  memberId: string | null;
  lastUserText: string;
  promptVersion: string;
}

async function handleFinish(opts: HandleFinishOptions): Promise<void> {
  const { event, tenantCtx, threadId, memberId, lastUserText, promptVersion } = opts;

  const assistantText: string = typeof event.text === "string" ? event.text : "";
  const usage = event.totalUsage ?? event.usage ?? {};
  const promptTokens: number = usage.inputTokens ?? usage.promptTokens ?? 0;
  const completionTokens: number = usage.outputTokens ?? usage.completionTokens ?? 0;

  // Refusal detection (REQ-06-06):
  // Detect the canned refusal phrase the prompt mandates for off-catalog questions.
  // Phrase-matching is more accurate than the zero-tool-calls heuristic:
  //   - False positive avoided: a clarifying answer with no tools is NOT a refusal.
  //   - False negative avoided: a reflexive search_catalog call followed by a refusal
  //     IS correctly flagged because the phrase appears in the final text.
  const isRefusal = isRefusalText(assistantText);

  // Persist user + assistant messages if we have a thread.
  if (threadId !== null) {
    await withTenantTx(tenantCtx, async (tx, ctx) => {
      // User message.
      if (lastUserText) {
        await appendMessage(tx, ctx, { threadId, role: "user", content: lastUserText });
      }
      // Assistant message with extracted book refs.
      const bookIds = extractBookRefs(assistantText);
      await appendMessage(tx, ctx, {
        threadId,
        role: "assistant",
        content: assistantText,
        ...(bookIds.length > 0 ? { bookIds } : {}),
      });
    });
  }

  // Record usage for cost ledger (own tx — may succeed even if message tx failed).
  await withTenantTx(tenantCtx, (tx, ctx) =>
    recordUsage(tx, ctx, {
      feature: "readers_advisor",
      model: MODELS.readersAdvisor,
      promptTokens,
      completionTokens,
      ...(threadId !== null ? { threadId } : {}),
    }),
  );

  // Log refusal if detected (own tx).
  if (isRefusal) {
    await withTenantTx(tenantCtx, (tx, ctx) =>
      logRefusal(tx, ctx, {
        ...(threadId !== null ? { threadId } : {}),
        ...(memberId !== null ? { memberId } : {}),
        userMessage: lastUserText,
        reason: "off_catalog",
      }),
    );
  }

  // Suppress unused-variable warning for promptVersion (used by tracing in Spec 11).
  void promptVersion;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the plain text content from a UIMessage whose role is "user".
 * Handles both string content and parts arrays (ai v6 UIMessage shape).
 */
// biome-ignore lint/suspicious/noExplicitAny: third-party UIMessage boundary
function extractUserText(msg: any): string {
  if (!msg) return "";
  // parts array (standard ai v6 UIMessage)
  if (Array.isArray(msg.parts)) {
    return (
      msg.parts
        // biome-ignore lint/suspicious/noExplicitAny: dynamic parts shape
        .filter((p: any) => p.type === "text")
        // biome-ignore lint/suspicious/noExplicitAny: dynamic parts shape
        .map((p: any) => (typeof p.text === "string" ? p.text : ""))
        .join("")
    );
  }
  // Legacy string content
  if (typeof msg.content === "string") return msg.content;
  return "";
}

/**
 * Returns true for errors that look like a gateway/network failure before streaming starts.
 * This is a best-effort check; unknown errors are re-thrown.
 */
function isGatewayError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("gateway") || msg.includes("502") || msg.includes("503");
}
