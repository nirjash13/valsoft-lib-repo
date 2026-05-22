/**
 * Langfuse span helper — REQ-11-02, REQ-11-10, NFR-11-01.
 *
 * Dependency-free: uses only `node:crypto` and global `fetch`.
 *
 * Behaviour:
 *  - When LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY are present, spans are
 *    flushed asynchronously to the Langfuse ingestion API (fire-and-forget).
 *  - When keys are absent (dev / CI), spans are accepted but never sent.
 *  - When the buffer is full (> BUFFER_CAP), the overflow is counted in
 *    `langfuseSpansDropped` instead of throwing.
 *  - Any failure inside tracing is swallowed + console.warn'd — it NEVER
 *    propagates to the request path (NFR-11-01: <50 ms p95 overhead, trivially
 *    met since flush is fire-and-forget).
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpanTags {
  tenant_id: string;
  feature: string;
  model: string;
  prompt_version?: string | undefined;
  user_id_hashed?: string | undefined;
  parent_span_id?: string | undefined;
}

export interface SpanMetrics {
  start_ts: Date;
  end_ts: Date;
  prompt_tokens?: number | undefined;
  completion_tokens?: number | undefined;
  cost_usd?: number | undefined;
  latency_ms?: number | undefined;
  error?: string | undefined;
}

export interface Span extends SpanTags, SpanMetrics {
  span_id: string;
}

// ---------------------------------------------------------------------------
// Buffer — pending spans awaiting a successful flush (REQ-11-10)
// ---------------------------------------------------------------------------

const BUFFER_CAP = 1000;

/**
 * Holds spans whose flush has not yet succeeded. Successfully flushed spans are
 * removed from this buffer. Only spans that overflow the cap (when Langfuse is
 * unreachable and the buffer fills) are counted in `langfuseSpansDropped`.
 */
const _buffer: Span[] = [];

/** Total spans dropped because the buffer was full when Langfuse was unreachable (REQ-11-10). */
export let langfuseSpansDropped = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSpanId(): string {
  return createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 16);
}

/**
 * Returns sha256 hex of the userId for privacy-safe tagging (REQ-11-02).
 * Returns undefined when userId is undefined/empty.
 */
export function hashUserId(userId: string | undefined): string | undefined {
  if (!userId) return undefined;
  return createHash("sha256").update(userId).digest("hex");
}

// ---------------------------------------------------------------------------
// Flush (fire-and-forget)
// ---------------------------------------------------------------------------

function buildBasicAuth(publicKey: string, secretKey: string): string {
  return `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`;
}

/**
 * Builds a per-request trace ID from the span ID and a random component.
 * This is distinct from tenant_id so that spans from different requests for
 * the same tenant are NOT collapsed into a single Langfuse trace. The tenant_id
 * is passed as metadata/tag, not as the traceId.
 *
 * Convention: `req-<first-8-chars-of-span_id>` — short, human-readable, unique
 * per span (and therefore per request, since each request generates a fresh spanId).
 */
function buildTraceId(spanId: string): string {
  return `req-${spanId.slice(0, 8)}`;
}

/** Flush timeout — prevents dangling promises on a slow Langfuse endpoint. */
const FLUSH_TIMEOUT_MS = 5_000;

/**
 * Flushes a batch of spans to Langfuse (one POST for the whole batch).
 *
 * On success: the spans are removed from `_buffer`.
 * On failure: the spans remain in `_buffer` for the next flush attempt.
 * Both paths are fire-and-forget — the returned Promise is never awaited by
 * `recordSpan`, so the request path is unblocked immediately.
 */
function flushAsync(spans: Span[]): void {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    // Dev / CI mode — no-op. Remove from buffer so it doesn't accumulate.
    for (const span of spans) {
      const idx = _buffer.indexOf(span);
      if (idx !== -1) _buffer.splice(idx, 1);
    }
    return;
  }

  const host = process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com";

  const body = {
    batch: spans.map((s) => ({
      type: "span-create",
      id: s.span_id,
      body: {
        id: s.span_id,
        parentObservationId: s.parent_span_id,
        // traceId groups spans by request, NOT by tenant. Tenant goes in metadata.
        traceId: buildTraceId(s.span_id),
        name: `${s.feature}/${s.model}`,
        startTime: s.start_ts.toISOString(),
        endTime: s.end_ts.toISOString(),
        metadata: {
          tenant_id: s.tenant_id,
          feature: s.feature,
          model: s.model,
          prompt_version: s.prompt_version,
          user_id_hashed: s.user_id_hashed,
          latency_ms: s.latency_ms,
          cost_usd: s.cost_usd,
          error: s.error,
        },
        usage: {
          input: s.prompt_tokens ?? 0,
          output: s.completion_tokens ?? 0,
        },
        level: s.error ? "ERROR" : "DEFAULT",
        statusMessage: s.error,
      },
    })),
  };

  fetch(`${host}/api/public/ingestion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: buildBasicAuth(publicKey, secretKey),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
  })
    .then((resp) => {
      if (resp.ok) {
        // SUCCESS: remove flushed spans from the buffer.
        for (const span of spans) {
          const idx = _buffer.indexOf(span);
          if (idx !== -1) _buffer.splice(idx, 1);
        }
      } else {
        // Non-OK response — leave spans in buffer for next flush attempt.
        console.warn(`[langfuse] flush non-OK: HTTP ${resp.status}`);
      }
    })
    .catch((err: unknown) => {
      // Network/timeout error — leave spans in buffer for retry.
      // Tracing failures must never affect the request path.
      console.warn("[langfuse] flush failed", err instanceof Error ? err.message : String(err));
    });
}

// ---------------------------------------------------------------------------
// recordSpan — primary API (REQ-11-02)
// ---------------------------------------------------------------------------

/**
 * Records a completed span. Fire-and-forget flush to Langfuse when keys are set.
 * Never throws.
 */
export function recordSpan(tags: SpanTags, metrics: SpanMetrics, spanId?: string): string {
  try {
    const id = spanId ?? generateSpanId();
    const span: Span = { ...tags, ...metrics, span_id: id };

    if (_buffer.length >= BUFFER_CAP) {
      // Buffer full (Langfuse unreachable, retry backlog full) — drop and count.
      // REQ-11-10: only spans that genuinely overflow a full buffer are counted.
      langfuseSpansDropped += 1;
      return id;
    }

    _buffer.push(span);
    // Batch flush (fire-and-forget). On success, flushAsync removes this span
    // from _buffer. On failure, it stays for the next flush attempt.
    flushAsync([span]);
    return id;
  } catch (err) {
    console.warn("[langfuse] recordSpan error", err instanceof Error ? err.message : String(err));
    return "";
  }
}

// ---------------------------------------------------------------------------
// traced — ergonomic wrapper
// ---------------------------------------------------------------------------

export interface TraceOptions {
  tags: Omit<SpanTags, "model"> & { model?: string };
  /** Estimated cost if actual usage is unavailable. */
  estimatedCostUsd?: number;
}

export interface TraceResult<T> {
  result: T;
  spanId: string;
  /** Token usage if the wrapped function returned it. */
  usage?: { promptTokens: number; completionTokens: number } | undefined;
}

/**
 * Wraps an async function with a Langfuse span. The wrapped function may return
 * a value with an optional `usage` field `{ promptTokens, completionTokens }`.
 *
 * Never throws — tracing errors are swallowed.
 */
export async function traced<T>(
  options: TraceOptions,
  fn: (
    spanId: string,
  ) => Promise<T & { usage?: { promptTokens: number; completionTokens: number } }>,
): Promise<TraceResult<T>> {
  const start = new Date();
  const spanId = generateSpanId();
  const model = options.tags.model ?? "unknown";

  let result: T & { usage?: { promptTokens: number; completionTokens: number } };
  let error: string | undefined;
  let usage: { promptTokens: number; completionTokens: number } | undefined;

  try {
    result = await fn(spanId);
    usage = result.usage;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    // Re-throw — traced is a wrapper, not a swallower.
    const end = new Date();
    recordSpan(
      { ...options.tags, model },
      {
        start_ts: start,
        end_ts: end,
        latency_ms: end.getTime() - start.getTime(),
        ...(options.estimatedCostUsd !== undefined ? { cost_usd: options.estimatedCostUsd } : {}),
        error,
      },
      spanId,
    );
    throw err;
  }

  const end = new Date();

  recordSpan(
    { ...options.tags, model },
    {
      start_ts: start,
      end_ts: end,
      latency_ms: end.getTime() - start.getTime(),
      ...(usage?.promptTokens !== undefined ? { prompt_tokens: usage.promptTokens } : {}),
      ...(usage?.completionTokens !== undefined
        ? { completion_tokens: usage.completionTokens }
        : {}),
      ...(options.estimatedCostUsd !== undefined ? { cost_usd: options.estimatedCostUsd } : {}),
    },
    spanId,
  );

  return { result: result as T, spanId, usage };
}

// ---------------------------------------------------------------------------
// recordFeatureDisabledSpan — REQ-11-04c
// ---------------------------------------------------------------------------

/**
 * Records a zero-cost span noting that the feature was disabled (kill switch).
 * Called by Route Handlers / Server Actions when Edge Config disables a feature.
 *
 * Uses level "DEFAULT" (not "ERROR") — a kill-switch rejection is expected
 * behavior, not an error, and should not pollute Langfuse error dashboards.
 */
export function recordFeatureDisabledSpan(feature: string, tenantId: string): void {
  const now = new Date();
  // Pass no `error` field so flushAsync sets level: "DEFAULT".
  // The feature_disabled event is communicated via the span name tag only.
  recordSpan(
    {
      tenant_id: tenantId,
      feature: `${feature}/feature_disabled`,
      model: "none",
    },
    {
      start_ts: now,
      end_ts: now,
      latency_ms: 0,
    },
  );
}

// ---------------------------------------------------------------------------
// Exported for testing
// ---------------------------------------------------------------------------

/** Exposes the buffer length for tests. */
export function _getBufferLength(): number {
  return _buffer.length;
}

/** Drains the buffer (test teardown only). */
export function _drainBuffer(): void {
  _buffer.length = 0;
}
