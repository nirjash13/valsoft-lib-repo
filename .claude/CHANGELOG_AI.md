# AI Changelog — Valsoft Library (Stack)

<!-- Machine-maintained changelog. Updated by /update-summary after significant changes. -->
<!-- Format: ## YYYY-MM-DD — Short Title -->
<!-- Each entry: what changed, files affected, decisions made. -->

## 2026-05-21 — Spec 02 Run A-fix: Critic findings addressed (F-1 through F-11)

**Fixes applied (8 findings, per critic Run A review):**

- **F-1 (HIGH)** `app/(app)/books/actions.ts`: `previewIsbnAction` permission changed from `book:read` → `ai:use_enrich`. Blocks guest/member abuse of AI budget + external API fan-out.
- **F-2 (HIGH)** `tests/integration/actions/create-book.test.ts`: `afterAll` cleanup rewritten. Disables `audit_log_no_delete` trigger before deleting audit rows, deletes by `tenant_id` (catches all test rows including the book), re-enables trigger. FK-safe order: audit_log → books → tenants.
- **F-3 (MEDIUM)** `lib/domain/books/preview-isbn.ts`: `assertAiBudget` moved outside `try` block so budget errors propagate. Inner `try` now wraps only `generateObjectViaGateway`. `catch {}` narrowed to `catch (err)` with `console.warn` — no silent swallow.
- **F-4 (MEDIUM)** `lib/domain/books/update-book.ts`: Added `isNull(books.deletedAt)` to UPDATE WHERE clause. `lib/domain/books/soft-delete-book.ts`: same predicate added so re-deleting already-deleted row affects 0 rows → `BookNotFoundError`.
- **F-5 (MEDIUM)** `lib/db/schema/_shared.ts`: `createdAt()` / `updatedAt()` helpers changed to `precision: 3` (ms). Migration `drizzle/0005_books_updated_at_precision.sql` ALTERs `books.created_at` and `books.updated_at` to `timestamptz(3)`. One unit test added: `tests/unit/domain/books/update-book.test.ts`.
- **F-6 (MEDIUM)** `tests/unit/domain/books/sources/merge.test.ts`: Dropped non-load-bearing `"returns empty record and empty diff when both sources are null"` test.
- **F-10 (LOW)** `tests/unit/domain/books/isbn.test.ts`: Renamed misleading test `"throws IsbnInvalidError for year=1200 equivalent — invalid checksum"` → `"throws IsbnInvalidError when ISBN-13 checksum is wrong"`.
- **F-11 (LOW)** `drizzle/0004_books_and_isbn_cache.sql`: Removed redundant `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO stack_app;` line (no sequences exist; 0002 default privileges already cover them).

**Deferred (recorded in active.yaml):** F-8 (LIKE wildcard escape — superseded by Spec 05), F-9 (restore-book error specificity), F-12 (Zod gate on cache write), F-13 (preview-isbn comment clarity).

**Verification:** tsc PASS, biome PASS, 20/20 unit tests, 13/13 db:verify, migration 0005 applied.

## 2026-05-21 — Spec 02 Run A: Book Management backend (CRUD + ISBN enrichment + AI gateway stub)

**What changed.**

Full backend implementation of Spec 02 — book management, ISBN enrichment, and AI infrastructure foundations.

**Key changes:**

- **Migration 0004** (`drizzle/0004_books_and_isbn_cache.sql`): `books` + `isbn_cache` tables with RLS FORCE, `assert_tenant()` isolation policies, composite tenant-first indexes, and explicit `stack_app` grants. 13/13 db:verify checks pass.
- **DB schema** (`lib/db/schema/books.ts`, `isbn-cache.ts`): Drizzle table definitions. `BookId` branded type added to `_shared.ts`.
- **ISBN domain** (`lib/domain/books/isbn.ts`): `validateIsbn13Checksum`, `isbn10ToIsbn13`, `normalizeIsbn` — pure, no deps.
- **BookRecord schema** (`lib/domain/books/schemas.ts`): Zod schemas for BookRecord, Create/Update/PreviewIsbn/ListBooks/SoftDelete/Restore inputs. Single source of truth for Server Actions, AI tool args, and client forms.
- **Source adapters** (`sources/open-library.ts`, `sources/google-books.ts`): `fetch` + `AbortSignal` 3s timeout; HTTP cover URL blocking; OL 404 + GB `totalItems=0` as "not found"; GB 429 as silent degradation.
- **Merge** (`sources/merge.ts`): OL wins; GB fills gaps; `sourcesDiff.year` for BDD "sources disagree" scenario.
- **ISBN cache** (`lib/domain/books/isbn-cache.ts`): `getCached` / `putCached` with `ON CONFLICT DO UPDATE`.
- **Preview orchestrator** (`preview-isbn.ts`): normalize → validate → cache → parallel fan-out → merge → optional LLM → cache → return.
- **CRUD domain functions**: `create-book.ts` (with audit), `update-book.ts` (optimistic concurrency), `soft-delete-book.ts` (hasActiveLoan stub), `restore-book.ts` (30-day window), `list-books.ts` (soft-delete filter), `get-book.ts`.
- **Loan stub** (`lib/domain/loans/has-active-loan.ts`): returns `false`, FOLLOW-UP for Spec 03.
- **AI gateway** (`lib/ai/gateway.ts`): `generateObjectViaGateway` — guards on `AI_GATEWAY_API_KEY`, biome-ignore for `as any` model cast (Spec 11 full wiring).
- **AI budget** (`lib/ai/budget.ts`): `assertAiBudget` reads `tenants.ai_monthly_cap_usd` via owner pool; throws `AiBudgetNotConfiguredError` if null/zero. Usage accumulation deferred to Spec 11.
- **Prompt** (`lib/ai/prompts/isbn-enrich.md`): versioned prompt (v1.0) with YAML frontmatter.
- **Server Actions** (`app/(app)/books/actions.ts`): `previewIsbnAction`, `createBookAction`, `updateBookAction`, `softDeleteBookAction`, `restoreBookAction`. Each: schema → permission gate → withTenantTx → domain fn → revalidateTag.
- **`handleServerError`** (`lib/auth/safe-action.ts`): extended with `BookNotFoundError→404`, `OptimisticConcurrencyError→409`, `BookHasActiveLoanError→422`, `IsbnInvalidError→422`.
- **Tests**: 7 unit tests (isbn.test.ts: 4, merge.test.ts: 4), integration test (create-book.test.ts, skipped when DB env absent).
- **Verification**: `scripts/verify-foundation.mjs` check #12 — books RLS cross-tenant probe.

**Decisions that diverged from prompt:**
- `revalidateTag` in Next.js 16 requires a second `profile` argument (breaking change vs. Next 15). Used `"default"` profile for all book cache invalidations.
- `biome-ignore lint/suspicious/noExplicitAny` used on gateway `model` cast — necessary because Vercel AI Gateway full provider setup (`createGateway()`) deferred to Spec 11.
- `BookId` branded type co-located in `lib/db/schema/_shared.ts` (not in `books.ts`) for consistency with `TenantId` / `UserId`.

**Verification:** `tsc --noEmit` PASS, `biome check .` PASS, `pnpm test:unit` 20/20 PASS, `pnpm db:apply 0004_books_and_isbn_cache` PASS (applied to Neon branch), `pnpm db:verify` 13/13 PASS.

## 2026-05-21 — Auth0 JWT shape pivot: roles in JWT, ROLE_PERMISSIONS table in TS

**Why.** The Auth0 Post-Login Action snippet originally suggested setting `permissions` from `event.authorization.permissions` — but that field does not exist on Auth0's `event.authorization` type (`{ roles: string[] }` only). Dashboard TS check refused to save the Action. Three options considered: (a) call Management API per login (slow), (b) duplicate the role/permission matrix as JS inside the Action (drift risk), (c) carry roles in JWT and resolve to permissions in TypeScript. Chose (c) — single source of truth in `lib/auth/permission.ts`.

**Key changes:**
- `lib/auth/permission.ts`: new `Role` type, `KNOWN_ROLES` set, `ROLE_PERMISSIONS` table, `permissionsForRoles(roles)` helper. The role→permission matrix lives here, nowhere else.
- `lib/auth/types.ts`: `Session.roles` replaces `Session.permissions`.
- `lib/auth/session.ts`: reads `user.roles` from the JWT (with `Array.isArray` defence) instead of `user.permissions`.
- `lib/auth/ability.ts`: `buildAbility(roles)` now flattens roles via `permissionsForRoles` then compiles to a CASL Ability. Public signature unchanged in argument type (still `readonly string[]`), unchanged in return type.
- `lib/auth/safe-action.ts`: passes `session.roles` to `buildAbility`; doc comment updated.
- `tests/unit/auth/ability.test.ts`: 4 tests rewritten to exercise role names (`tenant_admin`, `member`, `future_unknown_role`).
- `tests/unit/auth/safe-action.test.ts`: mock session now carries `roles: ["member"]`.
- `tests/integration/_README.md`: Auth0 Post-Login Action snippet corrected; added role-creation step for the demo organization.
- `.claude/CLAUDE.md`: stack table + "four layers" section updated to say `roles[]` instead of `permissions[]`.

**Files modified:** `lib/auth/permission.ts`, `lib/auth/types.ts`, `lib/auth/session.ts`, `lib/auth/ability.ts`, `lib/auth/safe-action.ts`, `tests/unit/auth/ability.test.ts`, `tests/unit/auth/safe-action.test.ts`, `tests/integration/_README.md`, `.claude/CLAUDE.md`, `.claude/memory/active.yaml`

**Verification:** `tsc --noEmit` PASS, `biome check .` PASS, `pnpm test:unit` 9/9 PASS, `pnpm db:verify` 12/12 PASS against real Neon branch.

**Spec note.** Spec 01 §3 still references `permissions[]` in JWT — that wording is a spec contract decision frozen at sign-off. The behavioural intent ("compile the user's authorization claim into a CASL Ability") is preserved. The mechanism (roles in JWT vs. permissions in JWT) is an implementation detail of Auth0's actual Action API. Not patching the spec mid-implementation; this changelog entry plus the `ROLE_PERMISSIONS` table's comment are the audit trail.

## 2026-05-21 — Spec 01 Run B-fix: org_id→UUID resolver + auth hardening + audit sole-insert-point

**What changed.** Fixed CRITICAL + 3 HIGH + 3 MEDIUM findings from the Run B critic review.

**Key changes:**
- New `lib/auth/resolve-tenant.ts`: resolves Auth0 org_id (text) to `tenants.id` (UUID) via owner connection (BYPASSRLS) with 5-min in-process cache. Fixes the CRITICAL runtime fault where `assert_tenant()` raised `invalid input syntax for type uuid` on every tenant-scoped query.
- `sessionToTenantCtx` is now `async` (awaits the resolver). All callers updated.
- New `lib/db/owner-pool.ts`: shared singleton pool for owner-connection operations. `withSystemOwnerTx` and `resolve-tenant.ts` both use it, eliminating the per-call `pool.end()` race.
- `lib/auth/permission.ts`: extracted `parsePermission` from `ability.ts` — sole source of truth for both callers.
- `handleServerError` now maps `ActionMetadataValidationError` → 403, `OrganizationMembershipRequiredError` → 403, `TenantNotProvisionedError` → 409.
- `writeSystemAuditLog` added to `lib/audit/audit-log.ts`; `provisionTenant` now uses it instead of bare `tx.insert`.
- Tenants RLS coupling documented in `drizzle/0003_tenants_rls.sql` and `tests/integration/_README.md`.
- `scripts/verify-foundation.mjs` extended with check #11 (org_id→UUID resolver probe).

**Files created:** `lib/auth/permission.ts`, `lib/auth/resolve-tenant.ts`, `lib/db/owner-pool.ts`, `tests/unit/auth/safe-action.test.ts`

**Files modified:** `lib/auth/ability.ts`, `lib/auth/errors.ts`, `lib/auth/session.ts`, `lib/auth/safe-action.ts`, `lib/audit/audit-log.ts`, `lib/db/with-system-owner-tx.ts`, `app/(admin)/tenants/actions.ts`, `drizzle/0003_tenants_rls.sql`, `tests/integration/_README.md`, `scripts/verify-foundation.mjs`

**Verification:** `tsc --noEmit` PASS, `biome check .` PASS, `pnpm test:unit` 9/9 PASS.

## 2026-05-21 — Spec 01 Run B: Auth layer + CASL + audit writer + provisioning + cross-tenant probe

**What changed.** Landed the application-layer auth + authorization stack on top of the Run A DB foundation. All unit tests pass; typecheck and biome clean; db:verify extended with 3 new cross-tenant probe checks (pending 0003 migration applied to Neon).

**Files created.**
- `lib/auth0.ts` — Auth0Client singleton (reads env vars automatically)
- `lib/auth/types.ts` — Session, TenantCtx, TenantId/UserId branded types
- `lib/auth/errors.ts` — UnauthorizedError, PermissionDeniedError, OrganizationMembershipRequiredError
- `lib/auth/session.ts` — getSession(), requireSession(), sessionToTenantCtx()
- `lib/auth/ability.ts` — buildAbility(permissions[]) → CASL PureAbility; forward-compat warn on unknown perms
- `lib/auth/safe-action.ts` — publicActionClient + actionClient (auth + CASL middleware + ProblemDetails error mapper)
- `lib/audit/audit-log.ts` — writeAuditLog(tx, ctx, entry): sole insert point; tenantId/actorId from ctx
- `middleware.ts` — Edge middleware: bypass public paths, delegate to Auth0 middleware
- `app/auth/[auth0]/route.ts` — GET handler for Auth0 SDK /auth/* routes
- `app/(admin)/tenants/actions.ts` — provisionTenant Server Action (tenant:provision gate, withSystemOwnerTx)
- `lib/db/with-system-owner-tx.ts` — owner-connection escape hatch for system_owner ops
- `drizzle/0003_tenants_rls.sql` — RLS FORCE on tenants; membership isolation + system_owner operator policy
- `drizzle/0003_tenants_rls.down.sql` — Rollback for 0003
- `tests/unit/auth/ability.test.ts` — 4 load-bearing CASL ability tests
- `tests/unit/audit/audit-log.test.ts` — 1 load-bearing audit-log insert security test

**Files modified.**
- `scripts/verify-foundation.mjs` — Check 1 updated (tenants now expected to have RLS); checks 8–10 added (cross-tenant probe on tenants table)
- `tests/integration/_README.md` — Run A complete; Run B documented

**Packages added.**
- `@auth0/nextjs-auth0` 4.20.0
- `@casl/ability` 6.8.1
- `next-safe-action` 7.10.8
- `jose` 5.10.0

**Decisions captured.**
- Auth0 SDK v4 uses `Auth0Client` class (not factory function); middleware handles /auth/* routes internally
- next-safe-action v7 `defineMetadataSchema()` requires a Zod Schema
- `withSystemOwnerTx` uses owner connection (BYPASSRLS) — correct escape hatch per Spec 01 §7
- Cross-tenant probe extended in verify-foundation.mjs script (not Vitest) — shares connection infrastructure

**Open items for Run C.**
- org_id → UUID resolver in sessionToTenantCtx (tenants.id is UUID; Auth0 org_id is text)
- Auth0 Post-Login Action deployment in dashboard (adds org_id + permissions[] to JWT)
- Migration 0003 apply to Neon dev branch + verify checks 8–10 pass

## 2026-05-21 — Spec 01 Run A — runtime hardening (verify-uncovered bugs fixed)

**What changed.** Provisioned a Neon dev branch, applied the Run A migration, and ran a scripted verification of the foundation against the real driver. The verify script (`scripts/verify-foundation.mjs`) uncovered three foundation bugs that all the unit tests had passed because the tests mock the Drizzle client. After fixes, all 8 verify checks + 3 unit tests + biome + typecheck are green.

**Bugs the verify script caught (none of which the unit tests could have).**

1. **CRITICAL — Postgres rejects `SET LOCAL app.tenant_id = $1` with a parser error.** Parameter placeholders are not allowed inside `SET LOCAL` syntax. The `withTenantTx` wrapper would have failed at runtime on every call. Fix: switched to `SELECT set_config('app.tenant_id', $1, true)` — the function form accepts parameters and `is_local=true` gives `SET LOCAL` semantics.

2. **HIGH — Custom GUC parameters (`app.*`) do NOT raise on unset via `current_setting()`.** They return an empty string. The Run A migration's policies (`current_setting('app.tenant_id')::uuid`) didn't raise on bypass — they silently returned zero rows, contradicting REQ-01-10 ("raises an exception"). Fix: new migration `0001_assert_tenant_guard.sql` adds a STABLE plpgsql function `assert_tenant()` that explicitly raises on null/empty and re-creates the three RLS policies to `USING (tenant_id = assert_tenant())`.

3. **CRITICAL — Neon's default role (`neondb_owner`) has `rolbypassrls = true`.** RLS doesn't apply for `BYPASSRLS` roles even with `FORCE ROW LEVEL SECURITY`. The dev verify script saw cross-tenant rows because the connecting role bypassed every policy. Fix: new migration `0002_app_role.sql` creates a non-`BYPASSRLS` role `stack_app` (the application's runtime role), grants it minimum data-plane privileges, and includes a self-test that refuses to commit if `stack_app` accidentally inherits `BYPASSRLS`. The owner role is reserved for migrations / scripts that need DDL or to operate above RLS (e.g., seeding cross-tenant test data).

**Connection-strategy split (locked).**
- `DATABASE_URL` → `stack_app` (NOBYPASSRLS, pooled) — used by app, RLS applies.
- `DATABASE_URL_UNPOOLED` → `neondb_owner` (BYPASSRLS, direct) — used by drizzle-kit, admin scripts.
- `DATABASE_URL_APP_DIRECT` → `stack_app` (NOBYPASSRLS, direct) — used by verify-foundation.mjs for the RLS test phase.

**Files changed (incremental on top of Run A).**
- `lib/db/with-tenant-tx.ts` — switched binding from `SET LOCAL = $1` to `SELECT set_config(_, $1, true)`. JSDoc explains why.
- `drizzle/0001_assert_tenant_guard.sql` + `.down.sql` — new patch migration: `assert_tenant()` function + policy replacement.
- `drizzle/0002_app_role.sql` + `.down.sql` — new patch migration: create `stack_app` role with NOBYPASSRLS + grants.
- `scripts/apply-migration.mjs` — one-shot migration applier (multi-statement SQL via WebSocket Pool). Used because drizzle-kit's `migrate` requires a journal that doesn't fit hand-authored RLS migrations.
- `scripts/verify-foundation.mjs` — dual-connection verifier (owner for setup, stack_app for RLS tests). 8 assertions, all PASS.
- `drizzle.config.ts` — loads `.env.local`, prefers `DATABASE_URL_UNPOOLED` for DDL.
- `tests/unit/db/with-tenant-tx.test.ts` — assertion updated to match `set_config(_, _, true)` first statement.
- `package.json` — `+dotenv`, removed `pg`/`@types/pg`, added `db:apply` / `db:bootstrap` / `db:verify` scripts.
- `biome.json` — ignore `.claude/scratch/**`.

**Decisions captured.**
- D-2026-05-21-set-config — Use `SELECT set_config(name, value, true)` (not `SET LOCAL = $1`) to bind GUC values from app code. Reason: PG parser rejects placeholders in `SET LOCAL`. Verified empirically.
- D-2026-05-21-assert-tenant-guard — RLS policies call `assert_tenant()` (STABLE plpgsql) which raises on unset `app.tenant_id`. Reason: PG custom GUC params don't raise from `current_setting()` directly. Verified empirically.
- D-2026-05-21-stack-app-role — Application connects as non-BYPASSRLS `stack_app`; migrations connect as `neondb_owner`. Reason: Neon's default role has `BYPASSRLS=true` which trumps `FORCE ROW LEVEL SECURITY`. Verified empirically. doc-04 had warned about this.

**Verification (against real Neon dev branch).**
| Check | Status |
|-------|--------|
| RLS + FORCE on tenant_memberships, members, audit_log | PASS |
| audit_log triggers (no_update, no_delete) | PASS |
| stack_app role NOBYPASSRLS | PASS |
| Bypass without app.tenant_id raises (assert_tenant) | PASS |
| set_config isolates A | PASS |
| set_config isolates B (reverse) | PASS |
| audit_log UPDATE raises append-only | PASS |
| audit_log DELETE raises append-only | PASS |
| Biome | PASS |
| Typecheck | PASS |
| Unit tests (3/3) | PASS |

---

## 2026-05-21 — Spec 01 Run A landed (scaffold + DB foundation + withTenantTx)

**What changed.** Scaffolded the Next.js 16 / Drizzle / pgvector-ready project from an empty repo and implemented the structural foundation of Spec 01 (REQ-01-03 partial, REQ-01-04, REQ-01-06 schema, REQ-01-10, NFR-01-03).

**Files created (24 source files, 1 migration, 2 lock files).**
- Root: `package.json` (Next 16.2.6, React 19.2.6, Drizzle 0.45.2, Vitest 4.1.7, Biome 1.9.4, ws 8.20.1), `tsconfig.json` (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes), `next.config.ts`, `biome.json`, `vitest.config.ts`, `drizzle.config.ts`, `.env.local.example`, `pnpm-workspace.yaml`, `.npmrc`, `pnpm-lock.yaml`
- `lib/db/`: `client.ts` (neon-serverless WebSocket Pool + ws shim), `with-tenant-tx.ts` (the four-layer wrapper + MissingTenantContextError + TxClient type), `schema/_shared.ts`, `schema/tenants.ts`, `schema/tenant-memberships.ts`, `schema/members.ts`, `schema/audit-log.ts`, `schema/index.ts`
- `drizzle/`: `0000_init.sql` (RLS FORCE on all tenant tables, audit_log append-only trigger, gen_random_uuid() via pgcrypto), `0000_init.down.sql` (idempotent reverse)
- Tests: `tests/unit/db/with-tenant-tx.test.ts` (3 load-bearing unit tests), `tests/integration/_README.md` (documented gates for Run B incl. tenants RLS gap)
- Folder skeleton + .gitkeeps for `app/`, `lib/auth/`, `lib/domain/{books,loans,members,search}`, `lib/ai/{tools,prompts}`, `lib/notifications`, `lib/audit`, `lib/utils`, `components/ui`, `evals`, `tests/e2e`, `public`
- Updated `.gitignore` to Node/Next.js
- Replaced `README.md` with Stack project README

**Critic-caught CRITICAL fix (in same run).** Initial Run A used `drizzle-orm/neon-http`, whose `db.transaction()` throws `"No transactions support in neon-http driver"` — `withTenantTx` would have been dead on arrival in production. Switched to `drizzle-orm/neon-serverless` with `Pool` from `@neondatabase/serverless` over WebSockets (same package, WebSocket protocol, interactive transactions supported). Also fixed: audit_log append-only via BEFORE UPDATE/DELETE trigger (REVOKE FROM PUBLIC is bypassed by table owner); dropped `true` arg in RLS policies so `current_setting` raises on unset per REQ-01-10; tightened test 2 assertion to `^\s*SET\s+LOCAL\s+app\.tenant_id\b` regex with negative `SET` check; added test 3 for empty userId validation; dropped unused uuid-ossp extension; documented tenants RLS gap for Run B.

**Verification.** `pnpm install`, `pnpm typecheck`, `pnpm exec biome check .`, `pnpm test:unit` (3/3) — all green. Integration tests skipped (no DATABASE_URL).

**Decisions captured.**
- D-2026-05-21-driver-neon-ws — Use Neon serverless WebSocket Pool (not HTTP driver) for all server-side DB access; HTTP driver removed entirely.
- D-2026-05-21-audit-append-only-trigger — Enforce audit_log append-only via BEFORE UPDATE/DELETE trigger (not REVOKE alone, not role-split).
- D-2026-05-21-rls-raise-on-unset — RLS policies use `current_setting('app.tenant_id')::uuid` (no `true` arg) so any query outside withTenantTx fails loudly.

**Open follow-ups for Run B** (documented in `tests/integration/_README.md`).
- Add RLS policy on `tenants` table gated by membership lookup
- Add operator-mode policy for `system_owner` per Spec 01 §7
- Integration tests against a real Neon dev branch: cross-tenant probe, audit-log trigger fires, RLS FORCE enumeration

---

## 2026-05-21 — CLAUDE.md + backend/migration rules rewritten for Next.js 16 stack

**What changed.** Replaced the .NET 9 / Clean-Architecture stack configuration with the locked Next.js 16 + Vercel + Neon + Auth0 Organizations + Drizzle + Vercel AI Gateway stack. Rewrote the two downstream rules files (`backend.md`, `migrations.md`) that referenced EF Core / dotnet commands.

**Files updated.**
- `.claude/CLAUDE.md` — full rewrite: runtime/tooling table, project structure (App Router + multi-tenant layout), naming conventions, type-safety rules, the `withTenantTx` four-layer pattern, Server Actions = commands + RSC/Route Handlers = queries, Drizzle + RLS patterns, AI rules (Gateway-only, budget pre-check, Langfuse spans, kill switches, versioned prompts), Vitest + Playwright testing, pnpm command catalogue, Next.js 16 framework-specific patterns.
- `.claude/rules/backend.md` — rewrite: module-shape architecture boundaries replace project-shape; forbidden cross-module references; ESLint rule names enumerated; pnpm verification commands.
- `.claude/rules/migrations.md` — rewrite: drizzle-kit workflow; RLS + FORCE + policy required on every tenant table; Neon preview branch per PR; destructive-migration `safety:reviewed` label gate; pgvector / tsvector index notes.

**Decision captured.**
- D-2026-05-21-claude-md-nextjs — full rewrite of `.claude/CLAUDE.md` + downstream rules for the Next.js 16 stack. Phase-0 blocker resolved.

**Working-title confirmations (from auto-mode question).** Product name **"Stack"**, demo theme **community/public library**, Reader's Advisor surface **⌘K primary + sidebar secondary** — all locked.

**Open blockers remaining.** Auth0 Organizations tier availability — owner: user. If unavailable, fallback is Clerk (Spec 01 patched in ~half a day) or the documented `tenant_id`-column model in `docs/analysis/04-multi-tenant-data-model.md`.

---

## 2026-05-21 — Feature spec set authored (12 specs + index)

**What changed.** Drafted the full feature specification set under `project_docs/specs/`. Each spec follows EARS functional requirements + BDD acceptance scenarios + NFRs + edge cases + sign-off block per the project Spec-Driven Workflow.

**Files added.**
- `project_docs/specs/00-INDEX.md` — value-mapping, reading paths, sign-off
- `project_docs/specs/01-foundation-multi-tenancy-auth.spec.md` — Auth0 Orgs + RLS FORCE + CASL RBAC + audit log
- `project_docs/specs/02-book-management.spec.md` — CRUD + one-paste ISBN-to-record enrichment + soft-delete with Trash
- `project_docs/specs/03-circulation.spec.md` — Borrow/Return + due dates + renewals + holds queue + `FOR UPDATE`
- `project_docs/specs/04-member-management.spec.md` — five roles + pre-seeded demo accounts + self-signup with librarian approval
- `project_docs/specs/05-search-discovery.spec.md` — hybrid lexical (tsvector) + semantic (pgvector HNSW) + RRF + books-like-this
- `project_docs/specs/06-readers-advisor.spec.md` — conversational RAG with tool calls + ⌘K & sidebar surfaces + refusal-by-design
- `project_docs/specs/07-notifications.spec.md` — overdue/hold-ready/welcome emails + AI-drafted with librarian review
- `project_docs/specs/08-reporting.spec.md` — six dashboards + NL-to-structured `ReportQuery` + AI usage breakdown
- `project_docs/specs/09-public-catalog.spec.md` — per-tenant ISR-cached read-only browse page; lexical-only public search
- `project_docs/specs/10-csv-import.spec.md` — streaming bulk import with batch enrichment + error report
- `project_docs/specs/11-ai-governance.spec.md` — AI Gateway routing + Langfuse spans + eval CI gates + cost caps + kill switches + cross-tenant probe
- `project_docs/specs/12-sdlc-cicd-pipeline.spec.md` — end-to-end GitHub Actions free-tier pipeline + the explicit "AI in SDLC" story

**Decisions captured** (also in `.claude/memory/decisions.md`):
- D-2026-05-21-stack-pivot — Next.js 16 full-stack on Vercel + Neon Postgres + pgvector (replaces the original .NET 10 plan)
- D-2026-05-21-solution-A-single-app — Solution A from RADAR adopted
- D-2026-05-21-ai-tier1 — three Tier-1 AI features locked
- D-2026-05-21-roles-and-signup — five-role hierarchy, pre-seeded demo accounts, self-signup w/ approval
- D-2026-05-21-borrow-return — UI verbs, unambiguous timestamp data fields
- D-2026-05-21-soft-delete — never hard-delete catalog rows
- D-2026-05-21-ai-in-sdlc — full AI-in-SDLC pipeline per Valsoft context

**Memory updates.** Added `valsoft_context`, `stack-decisions`, `stack-feature-map`; updated `MEMORY.md` index; refreshed `active.yaml`.

**Open blockers carried over.** `.claude/CLAUDE.md` is still .NET-oriented. It must be rewritten for the Next.js stack before any implementation begins. Owner: user. Auth0 Organizations tier verification: same owner, Phase 0 Day 1.

---

## 2026-05-21 — Requirements traceability matrix

**What changed.** Authored `docs/analysis/05-requirements-traceability.md` mapping every verbatim line of the assignment to FR coverage with status legend (✅ Met / ➕ Exceeds / ⚠ Partial / ❌ Gap / 🆕 Net-new), gap analysis, and a sign-off checklist. User signed off on 2026-05-21.

---

## 2026-05-21 — RADAR analysis & companion docs

**What changed.** Six analysis/design artifacts under `docs/analysis/` and `docs/design/`:
- `01-radar-analysis.md` — full RADAR workup with three candidates, pairwise comparison, recommendation, pre-mortem, 4-phase 28-day plan
- `02-ai-features-research.md` — nine AI feature candidates scored; tiered recommendation
- `03-tech-stack-decisions.md` — concrete choices inside Vercel + Next.js 16
- `04-multi-tenant-data-model.md` — schema, RLS, `withTenantTx` pattern
- `05-requirements-traceability.md` — see above
- `../design/design-system-brief.md` — Apple-inspired tokens / typography / motion / key screens

---

## 2026-05-21 — Project Bootstrap

- Initialized `.claude` setup (originally for .NET 9 / Clean Architecture; superseded by stack pivot above).
- Agent pipeline: architect-opus, builder-sonnet, critic-opus, writer-haiku.
- Memory system initialized.
