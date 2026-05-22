/**
 * POST /api/search — Hybrid search Route Handler (Spec 05 REQ-05-01).
 *
 * Accepts a JSON body matching SearchInputSchema. Returns:
 *   { results, facets, totalCount, cursor }
 *
 * Auth: requires a valid session (book:read permission).
 * Tenant isolation: enforced by withTenantTx + RLS FORCE.
 *
 * Public-catalog mode (REQ-05-10) is deferred to Spec 09. The domain function
 * supports mode='public_lexical_only' so Spec 09 can call it without refactoring.
 *
 * Zero-result logging (REQ-05-08) is handled inside hybridSearch automatically.
 */

export const runtime = "nodejs"; // pgvector requires Node; not Edge-compatible.

import { AiBudgetExceededError, AiBudgetNotConfiguredError } from "@/lib/ai/budget";
import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { EmbeddingFailedError } from "@/lib/domain/search/errors";
import { hybridSearch } from "@/lib/domain/search/hybrid-search";
import { SearchInputSchema } from "@/lib/domain/search/schemas";
import { problem } from "@/lib/http/problem";

export async function POST(req: Request): Promise<Response> {
  // --- Auth boundary ---
  const session = await requireSession().catch(() => null);
  if (!session) {
    return problem(401, "Unauthorized", "A valid session is required to search", "UNAUTHORIZED");
  }

  const ability = buildAbility(session.roles);
  if (!ability.can("read", "Book")) {
    return problem(
      403,
      "Forbidden",
      "You do not have permission to search books",
      "PERMISSION_DENIED",
    );
  }

  // --- Input validation ---
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problem(400, "Bad Request", "Request body must be valid JSON", "INVALID_JSON");
  }

  const parsed = SearchInputSchema.safeParse(body);
  if (!parsed.success) {
    return problem(
      422,
      "Unprocessable Entity",
      parsed.error.issues.map((i) => i.message).join("; "),
      "VALIDATION_ERROR",
    );
  }

  const input = parsed.data;

  // --- Execute search ---
  try {
    const tenantCtx = await sessionToTenantCtx(session);
    const response = await withTenantTx(tenantCtx, (tx, ctx) => hybridSearch(tx, ctx, input));

    return Response.json(response, { status: 200 });
  } catch (err) {
    // Map known domain errors to appropriate status codes.
    // Use instanceof (not constructor.name) — class names are mangled in production builds.
    if (err instanceof AiBudgetNotConfiguredError || err instanceof AiBudgetExceededError) {
      return problem(402, "Payment Required", err.message, "AI_BUDGET_EXCEEDED");
    }
    if (err instanceof EmbeddingFailedError) {
      // Graceful degradation: return empty results rather than 500
      // (the lexical path may still yield results; this indicates a gateway issue)
      return problem(
        503,
        "Service Unavailable",
        "Embedding service temporarily unavailable",
        "EMBEDDING_FAILED",
      );
    }

    // Generic 500 — no internal detail leaked
    return problem(500, "Internal Server Error", undefined, "INTERNAL_ERROR");
  }
}
