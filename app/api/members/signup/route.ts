/**
 * POST /api/members/signup — public self-signup Route Handler (REQ-04-02).
 *
 * This is a Route Handler rather than a Server Action because next-safe-action's
 * actionClient requires an authenticated session, and self-signup is pre-auth.
 * The publicActionClient alternative was considered but Server Actions must be
 * called from client components; a Route Handler is cleaner for unauthenticated
 * JSON API callers and easier to add CAPTCHA verification to.
 *
 * Tenant resolution:
 *   The tenant is resolved from the `X-Tenant-Slug` header (set by the middleware
 *   from the subdomain, e.g. acme.stack.app → "acme") or from the `slug` query
 *   param as a fallback for local dev. The tenantId is NEVER accepted from the
 *   request body — resolving it server-side from a verified source prevents tenant
 *   spoofing.
 *
 * CAPTCHA (NFR-04-02):
 *   DEFERRED to Run B — the token field is accepted here but not yet validated.
 *   A TODO marks the verification point.
 *
 * Returns:
 *   201 { memberId }   on success
 *   400 validation error
 *   409 email already registered (opaque — no status detail to avoid enumeration)
 *   404 tenant not found
 *   500 unexpected error
 */

export const runtime = "nodejs"; // pg driver requires Node runtime

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenants";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { MemberAlreadyExistsError } from "@/lib/domain/members/errors";
import { SelfSignupSchema } from "@/lib/domain/members/schemas";
import { selfSignup } from "@/lib/domain/members/self-signup";
import { problem } from "@/lib/http/problem";
import { eq } from "drizzle-orm";

export async function POST(req: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // 1. Resolve tenant from header / query param
  // ---------------------------------------------------------------------------
  const url = new URL(req.url);

  // Middleware writes the subdomain into X-Tenant-Slug.
  const slugFromHeader = req.headers.get("x-tenant-slug");
  // ?slug= query fallback is permitted only in non-production environments.
  // In production the middleware must set the header from the subdomain.
  const slugFromQuery = process.env.NODE_ENV !== "production" ? url.searchParams.get("slug") : null;
  const slug = slugFromHeader ?? slugFromQuery;

  if (!slug) {
    return problem(400, "Bad Request", "Tenant slug is required", "MISSING_TENANT_SLUG");
  }

  // Resolve slug → tenant.id using a raw owner connection is not available here
  // (we're inside a Route Handler, not a Server Action). Use the app DB client;
  // the tenants table has no RLS (see tenants.ts comment), so this query is safe
  // without SET LOCAL app.tenant_id.
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));

  if (!tenant) {
    return problem(404, "Not Found", "Library not found", "TENANT_NOT_FOUND");
  }

  const tenantId = tenant.id;

  // ---------------------------------------------------------------------------
  // 2. Parse + validate body
  // ---------------------------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problem(400, "Bad Request", "Request body must be valid JSON");
  }

  const parsed = SelfSignupSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        type: "about:blank",
        title: "Validation Error",
        status: 400,
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400, headers: { "Content-Type": "application/problem+json" } },
    );
  }

  const input = parsed.data;

  // ---------------------------------------------------------------------------
  // 3. CAPTCHA verification (NFR-04-02) — TODO Run B
  // ---------------------------------------------------------------------------
  // TODO: Verify Cloudflare Turnstile token (Q-04-03 resolution: Turnstile).
  // const captchaToken = (body as { captchaToken?: unknown }).captchaToken;
  // await verifyCaptcha(captchaToken);

  // ---------------------------------------------------------------------------
  // 4. Insert member row inside a tenant transaction
  // ---------------------------------------------------------------------------
  // The Route Handler has no session (unauthenticated call). We build a minimal
  // TenantCtx with a synthetic userId ("signup:self") so audit_log has a non-null
  // actorId. The audit_log.actor_id is stored as text, not FK to members.
  const syntheticCtx = {
    tenantId,
    userId: "signup:self",
  } as const;

  try {
    const { member } = await withTenantTx(syntheticCtx, async (tx, ctx) => {
      return selfSignup(tx, ctx, {
        displayName: input.displayName,
        email: input.email,
        phone: input.phone,
      });
    });

    return Response.json({ memberId: member.id }, { status: 201 });
  } catch (err) {
    if (err instanceof MemberAlreadyExistsError) {
      // REQ-04-02 BDD duplicate-signup: opaque message — no status detail to avoid enumeration.
      return problem(
        409,
        "Conflict",
        "This email already has an account at this library — try signing in",
        "MEMBER_ALREADY_EXISTS",
      );
    }
    throw err;
  }
}
