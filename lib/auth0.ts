/**
 * Auth0 SDK client singleton.
 *
 * Created once at module load; imported everywhere auth is needed.
 * Reads environment variables automatically:
 *   AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET, APP_BASE_URL
 *
 * AUTH0_ORG (optional): the Auth0 Organization id (e.g. "org_..."). When set,
 * we pass it as the `organization` parameter on /authorize so the JWT carries
 * an `org_id` claim. Without this, users who ARE org members still log in as
 * individuals and getSession() throws OrganizationMembershipRequiredError.
 *
 * @see https://github.com/auth0/nextjs-auth0
 */

import { Auth0Client } from "@auth0/nextjs-auth0/server";

const organization = process.env.AUTH0_ORG;

export const auth0 = new Auth0Client(
  organization ? { authorizationParameters: { organization } } : undefined,
);
