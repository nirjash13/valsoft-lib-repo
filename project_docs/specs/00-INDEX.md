<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Stack — Specification Set

**Date:** 2026-05-21
**Status:** Draft — Awaiting Sign-Off
**Audience:** Engineers, designers, reviewers, and the hiring panel.

Stack is a multi-tenant library platform. This folder holds the full set of feature specifications that translate the assignment brief (`project_docs/Valsoft_Library_assignment.pdf`) into implementable, testable units. Each spec is in EARS functional-requirement form with BDD acceptance scenarios, follows the project Spec-Driven Workflow, and traces back to the requirements matrix in [`../../docs/analysis/05-requirements-traceability.md`](../../docs/analysis/05-requirements-traceability.md).

> **Why this folder exists**, in one sentence: a hiring panel reading the repo should be able to walk from the assignment line they wrote → to the spec that satisfies it → to the test that proves it passes → to the CI job that runs that test on every PR. The traceability is the point.

---

## Reading order

| First-time reader | Path |
|---|---|
| **Hiring panel / Product Owner** | `00-INDEX.md` → `12-sdlc-cicd-pipeline.spec.md` → `01-foundation-multi-tenancy-auth.spec.md` → `06-readers-advisor.spec.md` |
| **Implementing engineer** | `00-INDEX.md` → `01-foundation` → `02-book-management` → `03-circulation` → `05-search-discovery` → rest in numeric order |
| **AI / ML reviewer** | `00-INDEX.md` → `11-ai-governance.spec.md` → `06-readers-advisor.spec.md` → `05-search-discovery.spec.md` → `02-book-management.spec.md` (ISBN enrichment) |
| **Designer** | `00-INDEX.md` → `../../docs/design/design-system-brief.md` → `06-readers-advisor.spec.md` (⌘K surface) → `02` & `03` |

---

## Spec inventory

| # | Spec | Satisfies (assignment) | Functional Reqs | Value-add beyond the brief |
|---|------|------------------------|----------------|----------------------------|
| 01 | [Foundation: multi-tenancy & auth](./01-foundation-multi-tenancy-auth.spec.md) | "SSO with roles and permissions" (Bonus) | FR-6, FR-7, FR-8, FR-9 | Auth0 **Organizations** as tenant boundary; four-layer isolation (Auth → repo guard → `SET LOCAL` → RLS FORCE); CASL RBAC; full audit log |
| 02 | [Book management](./02-book-management.spec.md) | "Add, edit, delete books with metadata" (Minimum) | FR-1, FR-2 | One-paste **ISBN-to-record enrichment** (Open Library + Google Books fan-out, LLM-normalized via `generateObject`); soft-delete with Trash view |
| 03 | [Circulation (Borrow/Return + holds)](./03-circulation.spec.md) | "Mark books checked in (borrowed) or checked out (returned)" (Minimum) | FR-3, FR-4, FR-14 | Holds queue with promotion, renewals with policy limits, per-book `FOR UPDATE` concurrency, audit per-action |
| 04 | [Member management & approval](./04-member-management.spec.md) | "Different user roles" (Bonus) extended | FR-7, FR-24 | **Pre-seeded admin accounts per role** + member **self-signup with librarian approval queue** — interactive demo flow |
| 05 | [Search & discovery](./05-search-discovery.spec.md) | "Find books by title, author, or other fields" (Minimum) | FR-5, FR-11, FR-16 | **Hybrid search**: pgvector HNSW + Postgres tsvector fused with Reciprocal Rank Fusion; "Books like this" |
| 06 | [Reader's Advisor (RAG chat)](./06-readers-advisor.spec.md) | "Implement any AI features" (Bonus) | FR-10 | Conversational RAG **with tool calls** (`search_catalog`, `get_book`, `check_availability`, `place_hold`); refuses out-of-catalog; ⌘K + sidebar surfaces |
| 07 | [Notifications & emails](./07-notifications.spec.md) | "AI features" (Bonus) | FR-15, FR-17 | Overdue/hold-ready/welcome emails; **AI-drafted with librarian review** (brand voice configurable per tenant) |
| 08 | [Reporting (incl. NL reporting)](./08-reporting.spec.md) | "Reporting" (interview ask) + "AI features" | FR-13, FR-18 | Operator dashboards + **NL-to-structured `ReportQuery`** (no free-form SQL); AI-usage breakdown |
| 09 | [Public catalog](./09-public-catalog.spec.md) | Creativity (Bonus) | FR-23 | Per-tenant **read-only public catalog URL** — shareable without login, ISR-cached |
| 10 | [CSV import](./10-csv-import.spec.md) | Creativity (Bonus) | FR-22 | Bulk catalog import from spreadsheet with **batch ISBN enrichment** — realistic onboarding for libraries migrating off Excel |
| 11 | [AI governance & observability](./11-ai-governance.spec.md) | "AI features" done responsibly | cross-cutting | AI Gateway routing, Langfuse spans, **eval-as-CI-gate**, per-tenant cost cap, kill switches, cross-tenant probe in evals |
| 12 | [SDLC / CI-CD pipeline](./12-sdlc-cicd-pipeline.spec.md) | "Working product" + interview ask | cross-cutting | **End-to-end AI-augmented SDLC** on GitHub Actions free tier — spec gates, eval gates, security scans, preview envs, Neon DB branches, automated AI code review |

---

## Value-mapping: how the proposed product exceeds the brief

The assignment specifies three minimum features and five optional bonus items. The set above delivers all of them and adds material capability beyond. The table below names exactly what is "free with purchase" — capability the brief did not ask for but the proposed solution provides.

| Capability | Assignment ask | What Stack delivers extra | Why it matters for Valsoft |
|------------|----------------|---------------------------|----------------------------|
| **Multi-tenancy** | Single-app prototype implied | Auth0 Orgs + RLS FORCE + four-layer isolation | Valsoft AI Labs serves a portfolio of 150+ vertical apps. Multi-tenant SaaS is the operating model of the org you'd be joining. |
| **AI as a product surface, not a feature** | "Implement any AI features" | Three Tier-1 AI features + observability + evals + cost caps + refusals | Demonstrates *modern AI engineering* (RAG, tool-calls, structured output, embeddings, evals, observability, routing). |
| **AI inside the SDLC** | Interview ask only — not in brief | Spec-driven workflow + AI-assisted code review (critic-opus) + eval CI gates + AI-PR labels + provenance markers on writer-haiku docs | This is the question they asked on the initial call. The repo is the answer. |
| **Observability & cost control** | Not asked | Langfuse spans tagged by tenant + feature, per-tenant monthly AI cost cap, kill switches per feature in Edge Config | Production-grade AI without runaway spend or unreviewable behavior — directly relevant to AI Labs operating cross-portfolio. |
| **Soft-delete + audit log** | Not asked | `books.deleted_at`, full `audit_log` table, UI-surfaced audit trail | No production library hard-deletes; procurement buyers require auditability. |
| **Public catalog page** | Not asked | Read-only per-tenant URL, ISR-cached, no login required | Free marketing surface and patron-lite mode. |
| **CSV import w/ batch enrichment** | Not asked | Streaming import with per-row enrichment + error report | Reality of how libraries actually onboard. |
| **Pre-seeded demo tenant** | Not asked | 1,000 curated books from Open Library + four demo accounts | Demo never starts empty; reviewer experience day-one. |
| **Apple-grade design system** | "Usability" criterion only | Token system, dark/light parity, reduced-motion, accessibility budget | Product Quality + Usability scored together. |
| **Spec-driven traceability** | "README" only | Every requirement traces brief → spec → test → CI job | Auditable engineering process. |

> **Net effect:** every "minimum" requirement is **Exceeded** (➕), every "bonus" requirement is **Met or Exceeded**, and a layer of platform capability sits on top that the brief never asked for — chosen because it is what an AI Engineering Manager at Valsoft would actually be expected to build.

---

## How a spec converts into shipped code

Each `*.spec.md` file is the input to one or more passes of the project's Spec-Driven Workflow. The conversion is:

1. **Stage 1 — Requirements** (done): `docs/analysis/01-radar-analysis.md` + `05-requirements-traceability.md` capture the *what* and *why*. ✅
2. **Stage 2 — Design Notes** (human-only): per-feature sketches under `project_docs/specs/_design-notes/` (created on demand for non-trivial flows; small features skip this).
3. **Stage 3 — Spec generation** (this folder): EARS functional reqs + BDD scenarios + NFRs + edge cases + sign-off block.
4. **Stage 4 — Implementation** (TDD via builder-sonnet): RED → GREEN → REFACTOR, one BDD scenario = one Vitest/Playwright test.
5. **Stage 4 — Review** (critic-opus): coverage matrix BDD ↔ test, NFR enforcement check, scope-creep check, security scan, design-alignment check. APPROVED required before PR opens.
6. **CI** ([`12-sdlc-cicd-pipeline.spec.md`](./12-sdlc-cicd-pipeline.spec.md)): every PR runs unit + integration + Playwright + eval gates + Lighthouse + dependency review.

Every spec ends with a sign-off block. No spec is `implementable` until that block is signed.

---

## Open questions across specs

These are caught here so they are visible in a single place; each spec also lists its own.

1. **[BLOCKING] Auth0 Organizations tier verification.** Owner: user. Deadline: Phase 0 Day 1. If unavailable on the chosen tier, the fallback is a `tenant_id` column with app-level enforcement (already designed in `04-multi-tenant-data-model.md` §Fallback).
2. **[BLOCKING] `.claude/CLAUDE.md` rewrite to Next.js 16 stack.** Owner: user. Deadline: Phase 0 Day 0–2. The current file is .NET-oriented; downstream agents will be misled until this is fixed.
3. **[NON-BLOCKING] Final product name.** Working title is "Stack". If the marketing decision changes, the repo name (`valsoft-library`) and Auth0 application name will be updated; nothing else needs to change.

---

## Sign-off for the spec set

This index is approved if and only if every individual spec is also approved.

- [ ] **Product Owner** confirms the spec set covers the assignment in full and exceeds where promised.
- [ ] **Tech Lead** confirms the architecture in `docs/analysis/01-radar-analysis.md` is consistent with every spec here.
- [ ] **AI/ML reviewer** confirms `11-ai-governance.spec.md` is sufficient before any code in `lib/ai/*` lands.
- [ ] All BLOCKING open questions above are resolved.
- [ ] Date approved: ___________

> **Next:** once signed, the implementing engineer runs `/spec-stage4-implement project_docs/specs/01-foundation-multi-tenancy-auth.spec.md` and walks the inventory in numerical order.
