/**
 * Vercel AI Gateway — the ONLY permitted entry point to LLMs in this codebase.
 *
 * ESLint rule `no-direct-llm-sdk` forbids importing `openai`, `@anthropic-ai/sdk`,
 * or any other provider SDK directly outside this file.
 *
 * How Vercel AI Gateway works:
 *   The `ai` package's `generateObject` / `generateText` / `streamText` / `embed`
 *   functions accept a `model` parameter that can be a gateway provider string like
 *   `"anthropic/claude-haiku-4-5"` or `"openai/text-embedding-3-small"`. Vercel
 *   routes the request through the AI Gateway, which handles routing, fallbacks,
 *   budgets, and observability. The gateway authenticates via `AI_GATEWAY_API_KEY`.
 *
 * Environment guards:
 *   - `AI_ENRICH_ENABLED=true` (default false) — if false, the gateway is never
 *     called from the ISBN enrichment path.
 *   - When `AI_ENRICH_ENABLED=true` and `AI_GATEWAY_API_KEY` is missing, throws
 *     `AiGatewayNotConfiguredError` before making any network call.
 *   - `AI_SEARCH_ENABLED=true` (default false) — guards the embedding path used
 *     by hybrid search (Spec 05). When false, semantic search is skipped.
 *
 * Tracing (REQ-11-02): every call records a Langfuse span via `lib/ai/tracing.ts`.
 * Spans are fire-and-forget and never block the request path (NFR-11-01).
 */

import type { TenantId } from "@/lib/db/schema/_shared";
import { embed, generateObject, streamText } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import type { z } from "zod";
import { hashUserId, recordSpan } from "./tracing";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AiGatewayNotConfiguredError extends Error {
  override readonly name = "AiGatewayNotConfiguredError";
  constructor() {
    super(
      "AI_GATEWAY_API_KEY is not set but AI_ENRICH_ENABLED=true — configure the key or disable enrichment",
    );
  }
}

// ---------------------------------------------------------------------------
// StreamTextParams
// ---------------------------------------------------------------------------

export interface StreamTextParams {
  /** Vercel AI Gateway model string, e.g. "anthropic/claude-sonnet-4-6" */
  model: string;
  system: string;
  messages: ModelMessage[];
  /** AI SDK tool definitions keyed by tool name. */
  tools?: ToolSet;
  tenantId: TenantId;
  /** Langfuse functionId tag, e.g. "readers_advisor" */
  feature: string;
  /** Optional hashed user ID for Langfuse span tagging (REQ-11-02). */
  userId?: string;
  /** Optional Langfuse prompt version for span tagging (REQ-11-02). */
  promptVersion?: string;
  /** Called when the stream completes (e.g. to persist assistant message). */
  onFinish?: Parameters<typeof streamText>[0]["onFinish"];
  abortSignal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// streamTextViaGateway
// ---------------------------------------------------------------------------

/**
 * Calls Vercel AI SDK `streamText` through the AI Gateway.
 *
 * Guards:
 *   1. Throws `AiGatewayNotConfiguredError` if `AI_GATEWAY_API_KEY` is absent.
 *   2. Passes `experimental_telemetry` with `functionId = feature` for tracing.
 *
 * Tracing: records a Langfuse span on stream completion via `onFinish` (REQ-11-02).
 * The span captures token usage when the AI SDK provides it.
 *
 * Returns the raw `streamText` result so the caller can call
 * `.toUIMessageStreamResponse()` or `.toDataStreamResponse()`.
 *
 * @throws AiGatewayNotConfiguredError if the API key is missing
 */
export function streamTextViaGateway(params: StreamTextParams) {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new AiGatewayNotConfiguredError();
  }

  const startTs = new Date();

  // Compose an onFinish wrapper that records the Langfuse span after the stream
  // completes. The caller's own onFinish (if any) is invoked first.
  const wrappedOnFinish: Parameters<typeof streamText>[0]["onFinish"] = async (event) => {
    // Call caller's onFinish first so usage data is persisted before span is recorded.
    if (params.onFinish) {
      await params.onFinish(event);
    }

    const endTs = new Date();
    recordSpan(
      {
        tenant_id: params.tenantId,
        feature: params.feature,
        model: params.model,
        prompt_version: params.promptVersion,
        user_id_hashed: hashUserId(params.userId),
      },
      {
        start_ts: startTs,
        end_ts: endTs,
        latency_ms: endTs.getTime() - startTs.getTime(),
        // AI SDK v6: usage is on event.usage
        prompt_tokens: event.usage?.inputTokens ?? 0,
        completion_tokens: event.usage?.outputTokens ?? 0,
      },
    );
  };

  return streamText({
    // biome-ignore lint/suspicious/noExplicitAny: Vercel AI Gateway provider stub — full provider wiring requires createGateway() setup per deployment
    model: params.model as any,
    system: params.system,
    messages: params.messages,
    ...(params.tools !== undefined ? { tools: params.tools } : {}),
    onFinish: wrappedOnFinish,
    ...(params.abortSignal !== undefined ? { abortSignal: params.abortSignal } : {}),
    experimental_telemetry: {
      isEnabled: true,
      functionId: params.feature,
    },
  });
}

// ---------------------------------------------------------------------------
// GenerateObjectParams
// ---------------------------------------------------------------------------

export interface GenerateObjectParams<T> {
  /** Vercel AI Gateway model string, e.g. "anthropic/claude-haiku-4-5" */
  model: string;
  /** Zod schema for the structured output */
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  tenantId: TenantId;
  feature: string;
  /** Optional hashed user ID for Langfuse span tagging (REQ-11-02). */
  userId?: string;
  /** Optional Langfuse prompt version for span tagging (REQ-11-02). */
  promptVersion?: string;
  /** Optional max tokens for the model output (e.g. 256 for structured-only responses). */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// generateObjectViaGateway
// ---------------------------------------------------------------------------

/**
 * Calls Vercel AI SDK `generateObject` through the AI Gateway.
 *
 * Guards:
 *   1. Throws `AiGatewayNotConfiguredError` if `AI_GATEWAY_API_KEY` is absent.
 *   2. Passes `experimental_telemetry` with `functionId = feature` for tracing.
 *
 * Tracing: records a Langfuse span after the call completes (REQ-11-02).
 * Span is fire-and-forget — it never blocks or throws to the caller.
 *
 * @throws AiGatewayNotConfiguredError if the key is missing
 * @throws ZodError if the model's output doesn't match the schema (generateObject throws)
 */
export async function generateObjectViaGateway<T>(
  params: GenerateObjectParams<T>,
): Promise<{ object: T; usage: { promptTokens: number; completionTokens: number } }> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new AiGatewayNotConfiguredError();
  }

  const startTs = new Date();
  let error: string | undefined;

  try {
    const result = await generateObject({
      // biome-ignore lint/suspicious/noExplicitAny: Vercel AI Gateway provider stub — full provider wiring requires createGateway() setup per deployment
      model: params.model as any,
      schema: params.schema,
      system: params.system,
      prompt: params.prompt,
      ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
      experimental_telemetry: {
        isEnabled: true,
        functionId: params.feature,
      },
    });

    const endTs = new Date();
    const promptTokens = result.usage?.inputTokens ?? 0;
    const completionTokens = result.usage?.outputTokens ?? 0;

    // Record Langfuse span (fire-and-forget, REQ-11-02).
    recordSpan(
      {
        tenant_id: params.tenantId,
        feature: params.feature,
        model: params.model,
        prompt_version: params.promptVersion,
        user_id_hashed: hashUserId(params.userId),
      },
      {
        start_ts: startTs,
        end_ts: endTs,
        latency_ms: endTs.getTime() - startTs.getTime(),
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      },
    );

    return {
      object: result.object,
      usage: { promptTokens, completionTokens },
    };
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    const endTs = new Date();
    recordSpan(
      {
        tenant_id: params.tenantId,
        feature: params.feature,
        model: params.model,
        prompt_version: params.promptVersion,
        user_id_hashed: hashUserId(params.userId),
      },
      {
        start_ts: startTs,
        end_ts: endTs,
        latency_ms: endTs.getTime() - startTs.getTime(),
        error,
      },
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GenerateEmbeddingParams / EmbeddingResult
// ---------------------------------------------------------------------------

export interface GenerateEmbeddingParams {
  /** Text to embed. Typically: title + authors + subjects + description. */
  text: string;
  /** Tenant ID used for budget pre-check (passed by the caller). */
  tenantId: TenantId;
  /** Langfuse functionId tag, e.g. "search-embed" or "search-query-embed". */
  functionId: string;
  /** Optional hashed user ID for Langfuse span tagging. */
  userId?: string;
}

export interface EmbeddingResult {
  embedding: number[];
  /** The model identifier used, e.g. "openai/text-embedding-3-small@v1". */
  model: string;
  /**
   * Actual token count from the AI SDK (input tokens consumed by the embedding
   * call). Null when the SDK does not return usage data. Passed through to
   * ai_usage rows so the cost ledger reflects real token counts, not zero.
   */
  promptTokens: number | null;
}

/**
 * The embedding model identifier sent to the Vercel AI Gateway.
 * text-embedding-3-small produces 1536-d embeddings, matching the pgvector schema.
 */
const EMBED_MODEL = "openai/text-embedding-3-small";

// ---------------------------------------------------------------------------
// generateEmbedding
// ---------------------------------------------------------------------------

/**
 * Generates a 1536-d embedding for `text` via the Vercel AI Gateway.
 *
 * Guards:
 *   1. Throws `AiGatewayNotConfiguredError` if `AI_GATEWAY_API_KEY` is absent.
 *   2. The caller MUST call `assertAiBudget(tenantId, EMBEDDING_COST_USD)` BEFORE
 *      this function — budget pre-check is the caller's responsibility to keep
 *      the gateway function single-purpose.
 *
 * Tracing: records a Langfuse span after the embedding completes (REQ-11-02).
 *
 * @throws AiGatewayNotConfiguredError if the API key is missing.
 * @throws Error (from AI SDK) if the embedding call fails.
 */
export async function generateEmbedding(params: GenerateEmbeddingParams): Promise<EmbeddingResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new AiGatewayNotConfiguredError();
  }

  const startTs = new Date();

  try {
    const result = await embed({
      // biome-ignore lint/suspicious/noExplicitAny: Vercel AI Gateway provider stub — full provider wiring requires createGateway() setup per deployment
      model: EMBED_MODEL as any,
      value: params.text,
      experimental_telemetry: {
        isEnabled: true,
        functionId: params.functionId,
      },
    });

    const endTs = new Date();

    // Record Langfuse span (fire-and-forget, REQ-11-02).
    recordSpan(
      {
        tenant_id: params.tenantId,
        feature: params.functionId,
        model: EMBED_MODEL,
        user_id_hashed: hashUserId(params.userId),
      },
      {
        start_ts: startTs,
        end_ts: endTs,
        latency_ms: endTs.getTime() - startTs.getTime(),
        prompt_tokens: result.usage?.tokens ?? 0,
        completion_tokens: 0,
      },
    );

    return {
      embedding: result.embedding,
      model: EMBED_MODEL,
      promptTokens: result.usage?.tokens ?? null,
    };
  } catch (err) {
    const endTs = new Date();
    recordSpan(
      {
        tenant_id: params.tenantId,
        feature: params.functionId,
        model: EMBED_MODEL,
        user_id_hashed: hashUserId(params.userId),
      },
      {
        start_ts: startTs,
        end_ts: endTs,
        latency_ms: endTs.getTime() - startTs.getTime(),
        error: err instanceof Error ? err.message : String(err),
      },
    );
    throw err;
  }
}
