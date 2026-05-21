/**
 * Next.js Edge Middleware — Auth0 session verification + tenant guard.
 *
 * Delegates to the Auth0 SDK middleware which handles:
 *   - JWT signature verification via cached JWKS (REQ-01-02)
 *   - Silent session refresh via refresh token rotation (REQ-01-08)
 *   - Redirect to Auth0 Universal Login for unauthenticated requests (REQ-01-01)
 *   - Serving the /auth/* SDK routes (/auth/login, /auth/callback, /auth/logout)
 *
 * Public surfaces (no auth needed):
 *   - /api/catalog/** — public read-only catalog API (Spec 09)
 *   - /api/webhooks/** — webhook handlers (auth via secret header, not session)
 *
 * The Auth0 middleware handles `/auth/*` routes automatically — do NOT redirect those.
 *
 * Edge case (Spec 01 §7): if the JWT is valid but carries no `org_id` claim,
 * `lib/auth/session.ts:getSession()` throws OrganizationMembershipRequiredError.
 * That error propagates up to Server Actions / RSC; middleware itself does not
 * inspect org_id (the Auth0 middleware layer does not expose session contents).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0 } from "./lib/auth0";

/**
 * Path prefixes that bypass auth entirely.
 * Note: Auth0 SDK handles its own /auth/* routes internally; don't list those here
 * because the SDK middleware needs to intercept them.
 */
const BYPASS_PREFIXES = ["/api/catalog/", "/api/webhooks/"] as const;

function isBypassPath(pathname: string): boolean {
  for (const prefix of BYPASS_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Fully public API paths — pass through without any auth processing
  if (isBypassPath(pathname)) {
    return NextResponse.next();
  }

  // DEV bypass: skip Auth0 middleware entirely so local dev doesn't need Auth0 configured.
  // SECURITY: this check runs in Edge — process.env is available there.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "1") {
    return NextResponse.next();
  }

  // Delegate all other routes to the Auth0 middleware.
  // The SDK handles /auth/* internally and protects everything else.
  return auth0.middleware(req);
}

export const config = {
  /**
   * Match all routes EXCEPT Next.js internals and static assets.
   * Route group names like `(app)` and `(public)` do NOT appear in URLs —
   * Next.js strips them. The bypass logic above handles the public/private split.
   */
  matcher: ["/((?!_next|favicon\\.ico|assets).*)"],
};
