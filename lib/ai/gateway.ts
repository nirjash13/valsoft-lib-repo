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
 * Spec 11 NOTE: Full Langfuse tracing integration (REQ-11-02) and gateway
 * provider type are deferred to Spec 11. For Run A, `experimental_telemetry`
 * is forwarded as-is when provided. The `model` string is passed directly to
 * the Vercel AI SDK functions.
 */

import type { TenantId } from "@/lib/db/schema/_shared";
import { embed, generateObject, streamText } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import type { z } from "zod";

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

  return streamText({
    // biome-ignore lint/suspicious/noExplicitAny: Vercel AI Gateway provider stub — full wiring in Spec 11
    model: params.model as any,
    system: params.system,
    messages: params.messages,
    ...(params.tools !== undefined ? { tools: params.tools } : {}),
    ...(params.onFinish !== undefined ? { onFinish: params.onFinish } : {}),
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

  // The `ai` package resolves the model string via the configured Vercel AI Gateway.
  // The gateway URL is inferred from the deployment context (VERCEL_AI_GATEWAY_BASE_URL
  // or the default Vercel gateway endpoint). For local dev without the gateway,
  // AI_ENRICH_ENABLED must be false (the caller guards this).
  const result = await generateObject({
    // The model string is passed as-is; Vercel AI SDK resolves it via the gateway.
    // We cast to `Parameters<typeof generateObject>[0]["model"]` via `as` because
    // the `ai` v6 gateway provider must be constructed with `createGateway()` in
    // a production setup. For Run A this is the stub gateway path; full wiring in Spec 11.
    // biome-ignore lint/suspicious/noExplicitAny: Vercel AI Gateway provider stub — full wiring in Spec 11
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

  // AI SDK v6 uses inputTokens / outputTokens on LanguageModelUsage.
  return {
    object: result.object,
    usage: {
      promptTokens: result.usage?.inputTokens ?? 0,
      completionTokens: result.usage?.outputTokens ?? 0,
    },
  };
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
}

export interface EmbeddingResult {
  embedding: number[];
  /** The model identifier used, e.g. "openai/text-embedding-3-small@v1". */
  model: string;
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
 * The `embed` function from the `ai` package routes through the Vercel AI Gateway
 * when the model string matches a gateway-registered provider. For local dev
 * without the gateway, set `AI_SEARCH_ENABLED=false` (the caller guards this).
 *
 * @throws AiGatewayNotConfiguredError if the API key is missing.
 * @throws Error (from AI SDK) if the embedding call fails.
 */
export async function generateEmbedding(params: GenerateEmbeddingParams): Promise<EmbeddingResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new AiGatewayNotConfiguredError();
  }

  // The `embed` function from the `ai` package accepts any model string that the
  // configured Vercel AI Gateway can resolve. We pass EMBED_MODEL as-is.
  // The model string is a gateway provider identifier; the `ai` package accepts it
  // as the `model` parameter. Full type wiring deferred to Spec 11.
  const result = await embed({
    // biome-ignore lint/suspicious/noExplicitAny: Vercel AI Gateway provider stub — full wiring in Spec 11
    model: EMBED_MODEL as any,
    value: params.text,
    experimental_telemetry: {
      isEnabled: true,
      functionId: params.functionId,
    },
  });

  return {
    embedding: result.embedding,
    model: EMBED_MODEL,
  };
}
