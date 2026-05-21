<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 01 — Foundation: Multi-Tenancy, Auth & Audit

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies assignment:** *"Add an authentication system with SSO, preferably with different user roles and permissions."* (Bonus 3.3)
**Architecture refs:** [01-radar-analysis](../../docs/analysis/01-radar-analysis.md) §4 · [04-multi-tenant-data-model](../../docs/analysis/04-multi-tenant-data-model.md)

---

## 1. What this feature is

Stack is a single application that serves many independent libraries. Each library is a **tenant**. Members of one tenant must be completely invisible to every other tenant — they cannot see each other's books, loans, members, or analytics, by accident or by adversarial effort. This spec defines the platform foundation that makes that guarantee real: identity, organization boundary, role-based authorization, request-scoped database isolation via Postgres Row-Level Security, and the audit log that records every authoritative action.

In plain language: this is the spec that turns a hobby app into a SaaS product that a procurement buyer would consider trusting with real circulation data.

> **Value beyond the brief.** The assignment asks only for "SSO, preferably with different roles." This spec delivers (a) **Auth0 Organizations as the tenant boundary** with org-aware JWTs, (b) **CASL-based RBAC** evaluated on every server action, (c) **four-layer tenant isolation** (auth → repo guard → request-scoped `SET LOCAL app.tenant_id` → RLS `FORCE`), and (d) a **system-wide audit log** UI-surfaced for librarians and admins. Items (a–d) are the work that would normally be a separate quarter of platform engineering.

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **Tenant** | One library. Everything one tenant does is invisible to every other tenant. |
| **Auth0 Organization** | Auth0's container for users that belong to a customer/tenant. Each Stack tenant = one Auth0 Organization. JWTs carry `org_id`. |
| **JWT claim** | A field in the signed token returned at login. We rely on `sub` (user id), `org_id` (tenant), and `permissions` (CASL rules). |
| **RLS** | Postgres Row-Level Security. A `USING` clause attached to every tenant-scoped table that says "rows are only visible if `tenant_id = current_setting('app.tenant_id')`." |
| **`SET LOCAL`** | Sets a Postgres setting for the *current transaction only* — safe with PgBouncer transaction pooling. Plain `SET` is forbidden because the setting would persist across transactions in a pool. |
| **CASL** | An isomorphic JS authorization library. We compile `permissions` claims into a CASL `Ability` and check `can(action, subject)` before every command. |
| **`audit_log`** | Append-only table; one row per authoritative action (create/update/delete on catalog, loans, members, settings, etc.) with `actor_id`, `tenant_id`, `action`, `before_json`, `after_json`, `occurred_at`. |
| **Role** | A named bundle of permissions. Five roles, defined in `04-member-management.spec.md`: System Owner, Tenant Admin, Librarian, Member, Guest. |

## 3. User stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a **librarian**, I need to sign in with my work email through SSO so that I do not maintain a separate password. | Must |
| US-02 | As a **tenant admin**, I need to be sure no other library can ever see my data so that I trust Stack with real circulation records. | Must |
| US-03 | As a **librarian at library A**, I need actions I take never to affect data in library B, even if I make a mistake. | Must |
| US-04 | As a **tenant admin**, I need to assign and revoke roles so that I control who can manage the catalog. | Must |
| US-05 | As a **tenant admin**, I need an audit log of every catalog/loan/member change with the actor's name and timestamp so that I can investigate disputes. | Must |
| US-06 | As a **system owner**, I need to provision a new tenant in under five minutes so that onboarding a new library is not a project. | Should |
| US-07 | As a **member**, I need to log in once per browser session via my library's SSO and not be re-prompted on every page. | Must |
| US-08 | As a **librarian**, I need the system to refuse my actions when my role does not permit them, with a message that names the missing permission so that I know whom to ask. | Should |

## 4. Functional requirements (EARS)

```
REQ-01-01: While an unauthenticated request reaches any route other than the public catalog (Spec 09) or sign-in,
when the request arrives, the system shall redirect to Auth0 Universal Login for the tenant inferred from the
hostname or subdomain.

REQ-01-02: When a user completes Auth0 login, the system shall issue an httpOnly secure session cookie containing
a JWT with claims { sub, org_id, permissions[], email } signed by Auth0 and verified server-side.

REQ-01-03: While a request is authenticated, when it enters any Server Action or Route Handler that touches the
database, the system shall (a) compile its `permissions[]` claim into a CASL Ability, (b) open a transaction, (c)
execute `SET LOCAL app.tenant_id = $org_id` as the first statement of that transaction, (d) execute all queries
through that connection, and (e) commit or rollback before releasing.

REQ-01-04: While Postgres holds any tenant-scoped table, when a query reads or writes that table, the system
shall enforce a Row-Level Security policy of the form `USING (tenant_id = current_setting('app.tenant_id')::uuid)`,
with `ALTER TABLE … FORCE ROW LEVEL SECURITY` so that even table-owner connections cannot bypass.

REQ-01-05: When a Server Action is invoked and the caller lacks the required CASL `can(action, subject)` permission,
the system shall reject the request with HTTP 403 and a `ProblemDetails` body naming the missing permission.

REQ-01-06: When any authoritative mutation (create/update/soft-delete on catalog, loans, members, holds, settings)
commits, the system shall write a single `audit_log` row with `tenant_id, actor_id, action, subject_type,
subject_id, before_json, after_json, occurred_at` inside the same transaction.

REQ-01-07: When a tenant admin invites a user via the admin UI, the system shall issue an Auth0 Organization
invitation with the chosen role, persist the pending invitation, and surface the invitation status in the UI
until accepted or revoked.

REQ-01-08: While a session token is older than 60 minutes, when a request arrives, the system shall silently
refresh via Auth0's refresh token rotation; on refresh failure it shall redirect to login.

REQ-01-09: While the platform is provisioning a new tenant, when a system owner submits the tenant form, the
system shall (a) create the Auth0 Organization, (b) insert a `tenants` row, (c) seed default roles, (d) create
the first tenant-admin invitation, and report any partial failure with a rollback prompt.

REQ-01-10: When `app.tenant_id` is not set in the current transaction, the system shall refuse to execute any
query against a tenant-scoped table — `current_setting('app.tenant_id', true)` returning NULL raises an exception
before the query proceeds.
```

## 5. Acceptance scenarios (BDD)

### REQ-01-01 — unauthenticated redirect
- **Given** no session cookie and a request to `/dashboard` on `acme.stack.app`
- **When** the request hits the edge middleware
- **Then** the response is `302` to `https://auth.stack.app/u/login?organization=acme&redirect_uri=...`
- **And** no database connection is opened.

### REQ-01-02 — JWT signature & claims
- **Given** a fresh Auth0 callback with a signed token
- **When** the callback handler runs
- **Then** the token signature verifies against the cached JWKS
- **And** the session contains `org_id`, `permissions[]`, `sub`, `email`
- **And** the cookie has `HttpOnly; Secure; SameSite=Lax`.

### REQ-01-03 — tenant binding & isolation
- **Given** a librarian at tenant A is signed in
- **When** they request `GET /api/books?q=jane`
- **Then** the server opens a transaction, runs `SET LOCAL app.tenant_id = '<A>'`, executes the query, and commits.
- **And** any attempt to swap `<A>` for `<B>` mid-flight is rejected because the JWT's `org_id` is the only source.

### REQ-01-04 — RLS catches a mistake
- **Given** a developer accidentally writes `SELECT * FROM books WHERE id = $1` without a `tenant_id` filter
- **When** the query runs inside a session bound to tenant A
- **Then** Postgres returns only rows where `tenant_id = A`, regardless of the `id` value
- **And** the equivalent query bound to no tenant raises `permission denied for table books`.

### REQ-01-05 — RBAC refusal
- **Given** a member calls `deleteBook(bookId)` Server Action
- **When** their `permissions[]` does not include `book:delete`
- **Then** the action returns 403 with body `{"detail":"missing permission: book:delete"}`
- **And** no DB write occurs.

### REQ-01-06 — audit row written
- **Given** a librarian edits a book title
- **When** the `editBook` Server Action commits
- **Then** the `audit_log` table contains exactly one new row with the actor, before/after JSON, and same `tx_id` as the catalog write.

### REQ-01-09 — tenant provisioning rollback
- **Given** Auth0 Organization creation succeeds but the `tenants` insert fails
- **When** the system owner submits the tenant form
- **Then** the partial Auth0 Org is marked `provisioning_failed=true` and the UI presents a "Cleanup" action
- **And** no half-tenant is visible in the tenant list.

### REQ-01-10 — missing tenant_id setting
- **Given** a query bypasses `withTenantTx()` and `app.tenant_id` is unset
- **When** any tenant-scoped query runs
- **Then** Postgres raises and the API returns 500 — failing loudly is the goal.

## 6. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-01-01 | Auth round-trip is fast | While Auth0 is healthy, when login completes, the system shall set the session cookie within 1.5 s p95. | 1.5 s p95 |
| NFR-01-02 | Tenant isolation cannot regress | When CI runs, the system shall execute a multi-tenant probe test that fails the build if any query returns a row from another tenant. | Build fails on cross-tenant leak |
| NFR-01-03 | Audit log is append-only | While the DB is online, no UPDATE or DELETE shall succeed against `audit_log` (Postgres revoke). | Revoke verified by integration test |
| NFR-01-04 | Audit write is atomic with the action | When a mutation commits, the matching audit row commits in the same transaction. | Atomicity verified by chaos test (kill server mid-tx → on restart, no orphan audit and no orphan write) |
| NFR-01-05 | RLS forced everywhere | While migrations are applied, every tenant-scoped table shall have RLS enabled AND `FORCE ROW LEVEL SECURITY`. | Migration test enumerates tables and checks `pg_class.relrowsecurity` and `relforcerowsecurity`. |

## 7. Edge cases

- **PgBouncer transaction pooling** — must use `SET LOCAL`, not `SET`. CI lints all `SET app.tenant_id` occurrences.
- **Background workflows** — Vercel Workflow handlers re-establish `app.tenant_id` from the workflow payload before any DB access.
- **System-owner cross-tenant queries** — explicit "operator mode" sets `app.tenant_id` to a wildcard sentinel and uses a separate RLS policy that allows reads but writes to `audit_log` with `actor_role='system_owner'`. Off by default; gated by a feature flag.
- **JWT clock skew** — accept ±60 s.
- **Org sync delays** — if Auth0 lists a user as belonging to org X but the DB has no `tenants` row for X, the request is rejected with a friendly "your library is not yet provisioned" page.

## 8. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-01-01 | Will the Auth0 plan provide the Organizations feature with `org_id` and `permissions` claims out of the box? | [BLOCKING] — owner: user, deadline Phase 0 Day 1 |
| Q-01-02 | Do we want operator-mode (cross-tenant read) in v1 or v2? | [NON-BLOCKING] — default v1 OFF |
| Q-01-03 | Are we storing PII (members' real names) in the audit log JSON, or just references? | [NON-BLOCKING] — recommend references-only |

## 9. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **Security reviewer:** ___________
- [ ] Date approved: ___________
- [ ] Blocking question Q-01-01 resolved.

> Next once signed: `/spec-stage4-implement project_docs/specs/01-foundation-multi-tenancy-auth.spec.md`.
