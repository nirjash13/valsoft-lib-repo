# Architectural Decisions

<!-- Record significant architectural decisions here. -->
<!-- Use /record-decision to add entries via the slash command. -->

## D-2026-05-21 — Pivot to Next.js 16 full-stack on Vercel + Neon

**Decision**: Drop the .NET 10 / EF assumption and build Stack as a single Next.js 16 application deployed on Vercel, with Neon Postgres (pgvector enabled) as the database.

**Rationale**: Vercel does not host .NET. The original brief said "deploy on Vercel," and we need one deployable that serves the API, the catalog UI, the public surface, and the AI chat. Next.js + Vercel + Neon Postgres is the natural alignment.

**Alternatives Considered**:
- Keep .NET API + Next.js frontend on separate hosts — rejected because the assignment specifies Vercel deploy; splitting fragments the demo.
- Static SPA + serverless functions — rejected because we need RSC, Server Actions, and Workflow DevKit for durable background work.

**Status**: Active

**Refs**: `docs/analysis/01-radar-analysis.md`, `docs/analysis/03-tech-stack-decisions.md`

---

## D-2026-05-21 — Solution A: single Next.js app, multi-tenant via Auth0 Orgs + RLS FORCE

**Decision**: Adopt Solution A from the RADAR analysis: a single Next.js app, all state in Postgres (including embeddings via pgvector), Auth0 Organizations as the tenant boundary, four-layer isolation (auth → repo guard → SET LOCAL app.tenant_id → RLS FORCE).

**Rationale**: The simplest topology that satisfies multi-tenancy, observability, AI features, and the timeline. Mistakes are caught by RLS at the DB layer even if application code drifts. Auth0 Organizations is the standard pattern for SaaS multi-tenancy.

**Alternatives Considered**: Solution B (microservices) — rejected for solo build, over-engineering. Solution C (separate DBs per tenant) — rejected because cross-tenant analytics + AI infra cost would balloon.

**Status**: Active

**Refs**: `docs/analysis/01-radar-analysis.md §Recommendation`, `project_docs/specs/01-foundation-multi-tenancy-auth.spec.md`

---

## D-2026-05-21 — AI Tier-1 feature set locked

**Decision**: Three Tier-1 AI features ship for v1: (a) hybrid catalog search (pgvector + tsvector + RRF), (b) Reader's Advisor conversational RAG with tool calls, (c) ISBN-to-record enrichment via `generateObject`. Tier-2 (books-like-this, AI-drafted emails, NL reporting) ships if time allows. Tier-3 (personalized recs) and the deferred (cover-scan, anomaly detection) do not.

**Rationale**: This set demonstrates RAG, tool-calling, structured output, embeddings, evals, observability, and cost-aware routing — every "modern AI engineering" capability — without exceeding a 3–4 week solo build budget.

**Refs**: `docs/analysis/02-ai-features-research.md`, `project_docs/specs/05-search-discovery.spec.md`, `06-readers-advisor.spec.md`, `02-book-management.spec.md`, `11-ai-governance.spec.md`

---

## D-2026-05-21 — Five-role hierarchy with member self-signup + librarian approval

**Decision**: Roles are System Owner / Tenant Admin / Librarian / Member / Guest. The demo tenant is pre-seeded with one demo account per role (`owner@stack.demo`, `admin@library.demo`, `librarian@library.demo`, `member@library.demo`) visible on the demo login page. Members self-signup on a public form per tenant → `status='pending'` → librarian approval queue → welcome email on approve / rejection email on reject.

**Rationale**: User asked for this explicitly in `docs/analysis/05-requirements-traceability.md` §8 (2026-05-21). The pre-seeded accounts let a reviewer experience the product from every role without configuration; the approval queue makes the demo interactive.

**Refs**: `project_docs/specs/04-member-management.spec.md`, `docs/analysis/05-requirements-traceability.md`

---

## D-2026-05-21 — UI verbs Borrow/Return; data fields checked_out_at/returned_at

**Decision**: The assignment's wording — "checked in (borrowed)" / "checked out (returned)" — inverts standard library usage. In Stack's **UI** we use member-facing verbs **"Borrow"** and **"Return"**; in the **data model** we use the unambiguous timestamps **`checked_out_at`** / **`returned_at`**.

**Rationale**: Honors assignment intent without locking the product to non-standard terminology. Avoids the cognitive trap of an inverted ontology in any future doc or onboarding.

**Refs**: `project_docs/specs/03-circulation.spec.md`, `docs/analysis/05-requirements-traceability.md` §1.2

---

## D-2026-05-21 — Soft-delete with Trash; never hard-delete

**Decision**: `books.deleted_at` instead of row removal. Tenant admins can restore from a Trash view within 30 days. After 30 days, anonymize-not-delete (keep title/authors so loan history remains readable; clear cover_url, description, custom_fields).

**Rationale**: `loans` and `audit_log` reference `books` rows. Production library systems never hard-delete. Hard-delete would either break loan history or require complex backfill of loan-line denormalization.

**Refs**: `project_docs/specs/02-book-management.spec.md` REQ-02-05..08

---

## D-2026-05-21 — AI in SDLC: spec gates, eval gates, AI-PR labels (Valsoft-driven)

**Decision**: The SDLC pipeline (`project_docs/specs/12-sdlc-cicd-pipeline.spec.md`) embeds AI in seven of eight stages (requirements, spec, implementation, code review, CI, operate, postmortem) and explicitly **excludes AI** from Design Notes. Required CI jobs include spec-gate, eval-ai, cross-tenant probe, AI-PR labelling.

**Rationale**: The Valsoft initial call asked specifically how AI would be used in the SDLC process. This spec is the explicit answer in shipped form. See `.claude/memory/valsoft_context.md`.

**Refs**: `project_docs/specs/12-sdlc-cicd-pipeline.spec.md`, `.claude/memory/valsoft_context.md`

---

## D-2026-05-21 — `.claude/CLAUDE.md` + backend/migration rules rewritten for Next.js 16

**Decision**: Rewrote `.claude/CLAUDE.md` from the .NET 9 / Clean-Architecture template into the locked Next.js 16 stack configuration. Rewrote `.claude/rules/backend.md` and `.claude/rules/migrations.md` in the same pass because they referenced EF Core / dotnet commands that would have actively misled builder agents.

**Rationale**: D-2026-05-21-stack-pivot locked the stack on 2026-05-21 but the agent-facing infrastructure file was still .NET-flavored. Builder agents read CLAUDE.md every turn; leaving it stale would have produced .NET-shaped Next.js code (wrong naming, wrong patterns, wrong test stack). User explicitly authorised the rewrite via auto-mode question on 2026-05-21.

**Key sections in the new CLAUDE.md**:
- Runtime & tooling table for the Next.js 16 stack
- Project structure for App Router + multi-tenant
- The `withTenantTx` four-layer isolation pattern as a first-class section
- Server Actions = commands / RSC + Route Handlers = queries (CQRS without MediatR)
- Drizzle + RLS migration patterns
- AI rules: Gateway-only, `assertAiBudget` pre-check, Langfuse spans, versioned prompts, Edge Config kill switches
- Vitest + Playwright + Storybook testing
- pnpm command catalogue
- Provenance markers for AI-authored docs / prompts

**Refs**: `.claude/CLAUDE.md`, `.claude/rules/backend.md`, `.claude/rules/migrations.md`, `docs/analysis/03-tech-stack-decisions.md`

---

## D-2026-05-21 — Working titles locked

**Decision**: Product name = **"Stack"**. Demo tenant theme = **community/public library**. Reader's Advisor surface = **⌘K primary + sidebar secondary**.

**Rationale**: User confirmed the auto-mode picks. "Stack" is short, memorable, references library stacks, and is already baked into all 13 specs. Public-library demo is the most accessible scenario for the hiring panel and has rich seed data. ⌘K + sidebar matches the modern AI-app pattern (Linear, GitHub Copilot, Raycast) and demos the best.

**Refs**: `project_docs/specs/00-INDEX.md`, `project_docs/specs/04-member-management.spec.md`, `project_docs/specs/06-readers-advisor.spec.md`

---

## D-2026-05-21 — Bind GUC values via `set_config()`, not `SET LOCAL = $1`

**Decision**: `withTenantTx` (and any other code that binds `app.tenant_id`/`app.user_id`) uses `SELECT set_config(name, value, true)` instead of `SET LOCAL name = $1`.

**Rationale**: Postgres rejects parameter placeholders in `SET LOCAL` syntax — `SET LOCAL app.tenant_id = $1` returns "syntax error at $1". The `set_config(text, text, boolean)` function form accepts parameters and `is_local=true` gives equivalent semantics. Verified empirically on Neon dev branch on 2026-05-21 via `scripts/verify-foundation.mjs`.

**Refs**: `lib/db/with-tenant-tx.ts`, `tests/unit/db/with-tenant-tx.test.ts`, `.claude/scratch/spec-01-runA-fix/verify-final.log`

---

## D-2026-05-21 — RLS policies use `assert_tenant()` guard function

**Decision**: All tenant-scoped RLS policies use `USING (tenant_id = assert_tenant())` where `assert_tenant()` is a STABLE plpgsql function that raises `insufficient_privilege` if `app.tenant_id` is null or empty.

**Rationale**: Postgres custom GUC parameters (those with a `.` in the name, like `app.tenant_id`) do NOT raise from `current_setting()` when unset — they return an empty string. Dropping the `, true` arg doesn't help because empty string also doesn't raise. The previous policies (`tenant_id = current_setting('app.tenant_id')::uuid`) silently returned zero rows when bypassed, contradicting REQ-01-10 ("raises an exception"). The `assert_tenant()` function makes the raise behavior explicit and discovered-at-write-time. Verified empirically.

**Refs**: `drizzle/0001_assert_tenant_guard.sql`, `scripts/verify-foundation.mjs` check #4

---

## D-2026-05-21 — App connects as `stack_app` (NOBYPASSRLS); migrations as `neondb_owner`

**Decision**: Application runtime queries use a dedicated Postgres role `stack_app` that is `NOSUPERUSER` and `NOBYPASSRLS`. Migrations and admin scripts use Neon's default `neondb_owner` role. The two roles get separate connection strings in `.env.local` (`DATABASE_URL` for the app, `DATABASE_URL_UNPOOLED` for DDL/admin).

**Rationale**: Neon's default `neondb_owner` role ships with `rolbypassrls=true`. Roles with `BYPASSRLS` skip RLS policies entirely, even when `FORCE ROW LEVEL SECURITY` is enabled — verified empirically by observing cross-tenant rows visible in a verify-foundation run on 2026-05-21. doc-04 had explicitly warned: "The app's DB role is **not** the table owner, so RLS is actually enforced [VERIFIED — Postgres docs gotcha]." Run A now follows that prescription.

**Refs**: `drizzle/0002_app_role.sql`, `scripts/verify-foundation.mjs`, `.env.local.example`

---

## D-2026-05-21 — Auth0 org_id → tenants.id resolver via owner connection

**Decision**: `lib/auth/resolve-tenant.ts` translates Auth0 `org_id` (text, e.g. `"org_abc123"`) to `tenants.id` (UUID) at session start. The lookup uses the owner connection (DATABASE_URL_UNPOOLED, BYPASSRLS) because stack_app + tenants RLS has a chicken-and-egg dependency on `app.tenant_id` being already bound. Results cached in-process for 5 minutes.

**Rationale**: Auth0's org_id is a text identifier that doesn't satisfy `::uuid` cast. `assert_tenant()` raised on every tenant-scoped query in Run B. The verify-foundation script masked this by seeding raw UUIDs. Critic-opus caught it before Spec 02 work began. Fix prescribed in `docs/analysis/04-multi-tenant-data-model.md §Token → tenant resolution`.

**Refs**: `lib/auth/resolve-tenant.ts`, `lib/db/owner-pool.ts`, `scripts/verify-foundation.mjs` check #12, `.claude/scratch/spec-01-runB/review.md` CRITICAL #1

---

## D-2026-05-21 — Audit log: writeSystemAuditLog as the single override path

**Decision**: `lib/audit/audit-log.ts` exports two writers — `writeAuditLog(tx, ctx, entry)` for normal tenant-scoped mutations (tenantId + actorId pulled from ctx), and `writeSystemAuditLog(tx, override, entry)` for system_owner operations where the tenantId is explicitly carried (e.g., the act of creating that tenant). The audit module remains the sole insert point for `audit_log`.

**Rationale**: Run B's first cut had `provisionTenant` bypass `writeAuditLog` and INSERT directly because the system_owner doesn't yet have a tenantCtx for the tenant being created. The bypass defeated the "sole insert point" invariant. The named-override pattern keeps both invariants: only audit-log code writes audit rows, and override is opt-in + grep-able.

**Refs**: `lib/audit/audit-log.ts`, `app/(admin)/tenants/actions.ts`, `.claude/scratch/spec-01-runB/review.md` MEDIUM #2

---

## D-2026-05-21 — Server Action permission gate: explicit refusal, not TypeError-to-500

**Decision**: Server Actions defined via `actionClient` without `.metadata({ permission })` are refused with HTTP 403 explicitly. Defense in depth: (a) `defineMetadataSchema()` makes Zod fail at parse time if metadata is missing/malformed; (b) the permission middleware explicitly checks `metadata.permission` and throws `PermissionDeniedError` if it's not a non-empty string. Both paths map to 403 in `handleServerError`. Unit-tested.

**Rationale**: In Run B's first cut, omitting `.metadata()` caused a TypeError that `handleServerError` mapped to a generic 500. That was "fails-closed by accident, not by design" — a future contributor could be misled. Explicit refusal is the correct shape.

**Refs**: `lib/auth/safe-action.ts`, `tests/unit/auth/safe-action.test.ts`, `.claude/scratch/spec-01-runB/review.md` HIGH #1

---

_Additional decisions will be appended here by /record-decision._
