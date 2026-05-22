/**
 * Advisor tool catalog — exports the factory that wires all 4 tools to the
 * current request's tenant context, CASL ability, and resolved member ID.
 *
 * Usage (in the route handler):
 *   const tools = buildAdvisorTools({ ctx, ability, memberId });
 *   streamTextViaGateway({ …, tools });
 */

import type { AppAbility } from "@/lib/auth/ability";
import type { TenantCtx } from "@/lib/db/with-tenant-tx";
import { checkAvailabilityTool } from "./check-availability";
import { getBookDetailTool } from "./get-book-detail";
import { placeHoldTool } from "./place-hold";
import { searchCatalogTool } from "./search-catalog";

export interface AdvisorToolsOptions {
  ctx: TenantCtx;
  ability: AppAbility;
  /** Resolved library member UUID for the authenticated user. Null if the user has no member record. */
  memberId: string | null;
}

/**
 * Builds the 4 Reader's Advisor tools wired to the current request's context.
 * Call once per request, not once per stream event.
 */
export function buildAdvisorTools(opts: AdvisorToolsOptions) {
  const { ctx, ability, memberId } = opts;
  return {
    search_catalog: searchCatalogTool(ctx),
    get_book_detail: getBookDetailTool(ctx),
    check_availability: checkAvailabilityTool(ctx),
    place_hold: placeHoldTool(ctx, ability, memberId),
  };
}
