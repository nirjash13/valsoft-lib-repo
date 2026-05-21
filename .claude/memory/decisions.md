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

_Additional decisions will be appended here by /record-decision._
