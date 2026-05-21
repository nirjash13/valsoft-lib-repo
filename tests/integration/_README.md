# Integration Tests

Integration tests in this directory run Vitest against a real Neon Postgres branch.

## Requirements

- `DATABASE_URL` pointing at a Neon test branch (not production).
- `DATABASE_URL_UNPOOLED` — neondb_owner direct connection (for owner-role operations).
- `DATABASE_URL_APP_DIRECT` — stack_app direct connection (for RLS enforcement checks).
- Migrations `drizzle/0000_init.sql`, `drizzle/0001_assert_tenant_guard.sql`,
  `drizzle/0002_app_role.sql`, `drizzle/0003_tenants_rls.sql` all applied.

## Run

```bash
pnpm test:integration
```

## Run A — Completed (2026-05-21)

All 8 checks from the Run A foundation verify pass via `pnpm db:verify`:
1. RLS enabled + FORCED on tenant_memberships, members, audit_log ✅
2. audit_log triggers (no_update, no_delete) exist ✅
3. stack_app role exists with NOBYPASSRLS ✅
4. As stack_app: members query without app.tenant_id raises (assert_tenant) ✅
5. As stack_app: set_config isolates members to bound tenant ✅
6. As stack_app: tenant B sees only its own members (reverse check) ✅
7. As stack_app: audit_log UPDATE raises 'append-only' ✅
8. As stack_app: audit_log DELETE raises 'append-only' ✅

## Run B — Completed (2026-05-21)

### Changes in Run B

- **Migration 0003**: `tenants` table now has RLS + FORCE enabled.
  - Policy `tenants_membership_isolation`: a user sees their own tenant(s) via `tenant_memberships`.
  - Policy `tenants_system_owner_access`: system_owner operations (via `withSystemOwnerTx`) set
    `app.system_owner = 'true'` to bypass tenant isolation for provisioning.

- **Cross-tenant probe checks added to `scripts/verify-foundation.mjs`** (checks 8–10):
  - Check 8: As stack_app bound to tenant A, `SELECT * FROM tenants` returns only tenant A's row.
  - Check 9: As stack_app bound to tenant A, `UPDATE tenants … WHERE id = <tenantB>` affects 0 rows.
  - Check 10: As stack_app bound to tenant A, `SELECT id FROM tenants WHERE id = <tenantB>` returns 0 rows.

  Run via: `pnpm db:verify` — checks 1–10 must all PASS.

- **Auth layer** (`lib/auth/`): session.ts, ability.ts, safe-action.ts, errors.ts, types.ts
- **Audit writer** (`lib/audit/audit-log.ts`)
- **Tenant provisioning action** (`app/(admin)/tenants/actions.ts`)
- **Unit tests**: `tests/unit/auth/ability.test.ts` (4 tests), `tests/unit/audit/audit-log.test.ts` (1 test)

### Auth0 dashboard config required before end-to-end flows work

The Auth0 Post-Login Action adds `org_id` + `roles[]` to the JWT and must be
manually deployed in the Auth0 dashboard. See
`docs/analysis/03-tech-stack-decisions.md §Auth0 setup`.

1. In Auth0 Dashboard → Actions → Library, create a Post-Login Action:
   ```javascript
   exports.onExecutePostLogin = async (event, api) => {
     if (event.organization) {
       api.idToken.setCustomClaim('org_id', event.organization.id);
       // event.authorization only exposes roles (not permissions). The app
       // resolves roles → permissions in TypeScript via ROLE_PERMISSIONS in
       // lib/auth/permission.ts.
       api.idToken.setCustomClaim('roles', event.authorization?.roles ?? []);
     }
   };
   ```
2. Attach the Action to the Login Flow.
3. The `org_id` claim identifies the tenant in the JWT; `roles` is the input to
   the app's `buildAbility(roles)` CASL builder.
4. In Auth0 Dashboard → Organizations → <your demo org> → Roles, create the five
   roles `system_owner`, `tenant_admin`, `librarian`, `member`, `guest` and
   assign at least one organization member the `tenant_admin` role so end-to-end
   login flows can exercise the admin permissions.

### Remaining tests planned for future runs

- Vitest integration tests for `createBook` + `writeAuditLog` atomicity (Run C)
- Playwright e2e: librarian login → book create → audit log visible (post-Run C)
- Cross-tenant probe for books/loans tables once those migrations land (Spec 02/03)
- Integration test for `resolveTenantIdByAuth0Org` + `sessionToTenantCtx` + `withTenantTx`
  round-trip (added to `scripts/verify-foundation.mjs` as check #11 in Run B-fix)

### RLS coupling: tenants_membership_isolation and app.tenant_id (Run B-fix note)

`drizzle/0003_tenants_rls.sql` — Policy `tenants_membership_isolation` subqueries
`tenant_memberships`, which itself has RLS `USING (tenant_id = assert_tenant())`.

**Consequence:** If `app.tenant_id` is not bound when the policy runs, `assert_tenant()`
raises `insufficient_privilege`. This makes it impossible to use the `stack_app` connection
to look up which tenant a user belongs to before `app.tenant_id` is bound — a
chicken-and-egg coupling.

**Resolution:** The org_id → UUID lookup is done via `lib/auth/resolve-tenant.ts` which
uses the owner connection (BYPASSRLS, `DATABASE_URL_UNPOOLED`). By the time the app
connection sets `app.tenant_id`, the UUID is already known. Documented in
`drizzle/0003_tenants_rls.sql` (comment above `CREATE POLICY tenants_membership_isolation`).

---

## Run B — tenants table RLS gap (RESOLVED)

~~The `tenants` table currently has **no RLS policy**.~~ ✅ Resolved by migration 0003_tenants_rls.sql.
