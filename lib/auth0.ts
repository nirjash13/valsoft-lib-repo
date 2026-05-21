/**
 * Auth0 SDK client singleton.
 *
 * Created once at module load; imported everywhere auth is needed.
 * Reads environment variables automatically:
 *   AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET, APP_BASE_URL
 *
 * @see https://github.com/auth0/nextjs-auth0
 */

import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client();
