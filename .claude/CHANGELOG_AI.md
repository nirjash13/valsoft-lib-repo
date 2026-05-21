# AI Changelog — Valsoft Library (Stack)

<!-- Machine-maintained changelog. Updated by /update-summary after significant changes. -->
<!-- Format: ## YYYY-MM-DD — Short Title -->
<!-- Each entry: what changed, files affected, decisions made. -->

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
