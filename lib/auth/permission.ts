/**
 * Permission string parser + role → permission mapping.
 *
 * Shared utility used by ability.ts and safe-action.ts. Extracted to prevent
 * divergence: if safe-action.ts parses "tenant:provision" differently than
 * ability.ts, the CASL can() check would silently fail or grant access
 * incorrectly. A single parsePermission in one module guarantees they stay
 * in sync.
 *
 * Role mapping rationale:
 *   Auth0 Post-Login Actions expose `event.authorization.roles: string[]` per
 *   organization membership, but DO NOT expose a `permissions[]` field on that
 *   event. We therefore put roles in the JWT and resolve role → permissions in
 *   TypeScript. This keeps the role/permission matrix in one place (here) and
 *   avoids the alternative of either (a) duplicating the matrix as JS inside
 *   the Auth0 Action, or (b) calling the Auth0 Management API on every login.
 *
 * REQ-01-03 a / REQ-01-05.
 */

// ---------------------------------------------------------------------------
// Subjects and actions (canonical sets — kept in sync with ability.ts types)
// ---------------------------------------------------------------------------

export type AppSubject =
  | "Book"
  | "Loan"
  | "Member"
  | "Tenant"
  | "AuditLog"
  | "Hold"
  | "Report"
  | "AI";

export type AppAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "checkout"
  | "checkin"
  | "override_due"
  | "manage"
  | "settings"
  | "provision"
  | "use_chat"
  | "use_enrich"
  | "view";

export const KNOWN_SUBJECTS: ReadonlySet<string> = new Set<AppSubject>([
  "Book",
  "Loan",
  "Member",
  "Tenant",
  "AuditLog",
  "Hold",
  "Report",
  "AI",
]);

export const KNOWN_ACTIONS: ReadonlySet<string> = new Set<AppAction>([
  "read",
  "create",
  "update",
  "delete",
  "checkout",
  "checkin",
  "override_due",
  "manage",
  "settings",
  "provision",
  "use_chat",
  "use_enrich",
  "view",
]);

// ---------------------------------------------------------------------------
// Roles and role → permission mapping
// ---------------------------------------------------------------------------

/**
 * The five canonical roles. Matches the CHECK constraint on
 * `tenant_memberships.role` in `drizzle/0000_init.sql`.
 *
 * `system_owner` exists outside any single tenant (it is the SaaS operator
 * role) but is still represented here so the Ability builder is uniform.
 */
export type Role = "system_owner" | "tenant_admin" | "librarian" | "member" | "guest";

export const KNOWN_ROLES: ReadonlySet<string> = new Set<Role>([
  "system_owner",
  "tenant_admin",
  "librarian",
  "member",
  "guest",
]);

/**
 * Role → granted permissions. Single source of truth for authorization.
 *
 * Editing this table is a security-sensitive change — every entry should match
 * the matrix in `docs/analysis/04-multi-tenant-data-model.md §Role matrix`.
 *
 * - system_owner — provisioning + cross-tenant audit only; NEVER tenant data
 *   (which it can't read anyway because withSystemOwnerTx is a separate path).
 * - tenant_admin — full tenant control: catalog, members, settings, audit, AI.
 * - librarian    — daily circulation work: catalog edit, loans, holds, AI.
 *                  No hard delete, no tenant settings.
 * - member       — read catalog + own loans/holds; ask Reader's Advisor.
 * - guest        — public catalog read + Reader's Advisor only (no PII).
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly string[]>> = {
  system_owner: ["tenant:provision", "auditlog:read", "report:view"],
  tenant_admin: [
    "book:create",
    "book:read",
    "book:update",
    "book:delete",
    "book:manage",
    "loan:create",
    "loan:read",
    "loan:update",
    "loan:checkout",
    "loan:checkin",
    "loan:override_due",
    "loan:manage",
    "member:create",
    "member:read",
    "member:update",
    "member:delete",
    "member:manage",
    "hold:create",
    "hold:read",
    "hold:update",
    "hold:delete",
    "hold:manage",
    "tenant:settings",
    "tenant:read",
    "auditlog:read",
    "report:view",
    "ai:use_chat",
    "ai:use_enrich",
  ],
  librarian: [
    "book:create",
    "book:read",
    "book:update",
    "loan:create",
    "loan:read",
    "loan:update",
    "loan:checkout",
    "loan:checkin",
    "loan:override_due",
    "member:create",
    "member:read",
    "member:update",
    "hold:create",
    "hold:read",
    "hold:update",
    "hold:delete", // Spec 03: librarians can cancel holds on behalf of members
    "auditlog:read",
    "ai:use_chat",
    "ai:use_enrich",
  ],
  member: ["book:read", "loan:read", "hold:create", "hold:read", "ai:use_chat"],
  guest: ["book:read", "ai:use_chat"],
};

/**
 * Flattens a list of role names to the deduplicated set of permission strings
 * those roles grant. Unknown role names are silently skipped (forward-compat
 * with future Auth0 roles added before a deploy). Order is not significant.
 */
export function permissionsForRoles(roles: readonly string[]): readonly string[] {
  const out = new Set<string>();
  for (const role of roles) {
    if (!KNOWN_ROLES.has(role)) continue;
    const perms = ROLE_PERMISSIONS[role as Role];
    for (const p of perms) out.add(p);
  }
  return Array.from(out);
}

// ---------------------------------------------------------------------------
// parsePermission
// ---------------------------------------------------------------------------

/**
 * Parses a permission string of the form `subject:action` into typed parts.
 *
 * The subject is title-cased by convention:
 *   "book:create"      → { subject: "Book",   action: "create" }
 *   "tenant:settings"  → { subject: "Tenant", action: "settings" }
 *   "ai:use_chat"      → { subject: "AI",     action: "use_chat" }
 *
 * Returns `null` for any unparseable or unknown string. Callers must handle null
 * and NOT throw — forward-compat for new permissions added in Auth0 before a deploy.
 */
export function parsePermission(raw: string): { subject: AppSubject; action: AppAction } | null {
  const colonIndex = raw.indexOf(":");
  if (colonIndex === -1) return null;

  const rawSubject = raw.slice(0, colonIndex);
  const rawAction = raw.slice(colonIndex + 1);

  // Title-case the subject for canonical match. Multi-word subjects ("auditlog")
  // and acronyms ("ai") need explicit mappings — the simple .charAt(0).toUpperCase()
  // path would produce "Auditlog" (lowercase L) which doesn't match "AuditLog".
  const lowerSubject = rawSubject.toLowerCase();
  const subject =
    lowerSubject === "ai"
      ? "AI"
      : lowerSubject === "auditlog"
        ? "AuditLog"
        : rawSubject.charAt(0).toUpperCase() + rawSubject.slice(1).toLowerCase();

  const action = rawAction.toLowerCase();

  if (!KNOWN_SUBJECTS.has(subject)) return null;
  if (!KNOWN_ACTIONS.has(action)) return null;

  return { subject: subject as AppSubject, action: action as AppAction };
}
