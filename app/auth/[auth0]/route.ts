/**
 * Auth0 SDK route handler.
 *
 * The Auth0 SDK v4 handles auth routes via its middleware (middleware.ts), which
 * intercepts /auth/* paths automatically. However, we also export a GET handler
 * here as a fallback for Pages Router compatibility and for explicit route registration.
 *
 * Routes handled by the SDK:
 *   GET /auth/login       → initiates Auth0 Universal Login flow
 *   GET /auth/callback    → processes the Auth0 callback after login
 *   GET /auth/logout      → clears session cookie + logs out of Auth0
 *   GET /auth/access-token → returns current access token (for client components)
 *
 * Required env vars (set via Vercel / .env.local):
 *   AUTH0_DOMAIN           e.g. your-tenant.us.auth0.com
 *   AUTH0_CLIENT_ID        e.g. abc123
 *   AUTH0_CLIENT_SECRET    (secret — never in client bundle)
 *   AUTH0_SECRET           32-byte hex secret for cookie signing
 *   APP_BASE_URL           e.g. https://stack.app or http://localhost:3000 in dev
 */

import { auth0 } from "@/lib/auth0";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest): Promise<Response> {
  return auth0.middleware(req);
}
