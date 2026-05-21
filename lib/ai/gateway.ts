/**
 * Vercel AI Gateway — the ONLY permitted entry point to LLMs in this codebase.
 *
 * ESLint rule `no-direct-llm-sdk` forbids importing `openai`, `@anthropic-ai/sdk`,
 * or any other provider SDK directly outside this file.
 *
 * How Vercel AI Gateway works:
 *   The `ai` package's `generateObject` / `generateText` / `streamText` accept
 *   a `model` parameter that can be a gateway provider string like
 *   `"anthropic/claude-haiku-4-5"`. Vercel routes the request through the
 *   AI Gateway, which handles routing, fallbacks, budgets, and observability.
 *   The gateway authenticates via `AI_GATEWAY_API_KEY` env var.
 *
 * Environment guards:
 *   - `AI_ENRICH_ENABLED=true` (default false) — if false, the gateway is never
 *     called from the ISBN enrichment path.
 *   - When `AI_ENRICH_ENABLED=true` and `AI_GATEWAY_API_KEY` is missing, throws
 *     `AiGatewayNotConfiguredError` before making any network call.
 *
 * Spec 11 NOTE: Full Langfuse tracing integration (REQ-11-02) and gateway
 * provider type are deferred to Spec 11. For Run A, `experimental_telemetry`
 * is forwarded as-is when provided. The `model` string is passed directly to
 * the Vercel AI SDK `generateObject`.
 */

import type { TenantId } from "@/lib/db/schema/_shared";
import { generateObject } from "ai";
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
export async function generateObjectViaGateway<T>(params: GenerateObjectParams<T>): Promise<T> {
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
    experimental_telemetry: {
      isEnabled: true,
      functionId: params.feature,
    },
  });

  return result.object;
}
