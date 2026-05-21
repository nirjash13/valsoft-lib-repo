/**
 * CASL Ability builder — compiles JWT `roles[]` into a typed Ability.
 *
 * Auth0 Post-Login Actions expose `event.authorization.roles: string[]` per
 * organization membership, not a flat `permissions[]` array. We therefore put
 * roles in the JWT and resolve role → permissions in TypeScript via the
 * `ROLE_PERMISSIONS` table in `lib/auth/permission.ts`.
 *
 * Permission strings follow the pattern `subject:action` (e.g. `book:create`).
 * Parsing logic lives in `lib/auth/permission.ts` (shared with safe-action.ts)
 * to prevent the two callers from diverging on how "subject:action" strings
 * are split and normalised.
 *
 * REQ-01-03 a: "compile its role claim into a CASL Ability"
 * REQ-01-05: "the system shall reject … if the caller lacks the required CASL
 *             `can(action, subject)` permission"
 */

import { AbilityBuilder, PureAbility } from "@casl/ability";
import {
  type AppAction,
  type AppSubject,
  parsePermission,
  permissionsForRoles,
} from "./permission";

// ---------------------------------------------------------------------------
// Re-exports for consumers that previously imported these from ability.ts
// ---------------------------------------------------------------------------

export type { AppAction, AppSubject, Role } from "./permission";

// ---------------------------------------------------------------------------
// AppAbility
// ---------------------------------------------------------------------------

export type AppAbility = PureAbility<[AppAction, AppSubject]>;

// ---------------------------------------------------------------------------
// buildAbility
// ---------------------------------------------------------------------------

/**
 * Compiles a flat `roles[]` array (from the JWT) into a CASL Ability.
 *
 * - Default deny: an empty array yields an Ability that denies everything.
 * - Unknown role names are silently skipped (forward-compat with Auth0 roles
 *   added before a deploy updates this mapping).
 * - The Ability is immutable once built — reconstruct per request.
 */
export function buildAbility(roles: readonly string[]): AppAbility {
  const builder = new AbilityBuilder<AppAbility>(PureAbility);

  const permissions = permissionsForRoles(roles);

  for (const raw of permissions) {
    const parsed = parsePermission(raw);
    if (!parsed) {
      // Should be unreachable — ROLE_PERMISSIONS entries are author-controlled.
      // Defensive: a typo in the table is ignored rather than silently granting
      // unrelated rights.
      console.warn(`[buildAbility] Unparseable permission string in ROLE_PERMISSIONS: "${raw}"`);
      continue;
    }
    builder.can(parsed.action, parsed.subject);
  }

  return builder.build();
}
