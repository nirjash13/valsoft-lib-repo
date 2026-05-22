# Stack — Library Platform

**A multi-tenant library management SaaS where every library gets its own private, AI-native instance.**

Live: [https://stacked-ivory.vercel.app](https://stacked-ivory.vercel.app) · Public catalog (no login): [https://stacked-ivory.vercel.app/stack-public/catalog](https://stacked-ivory.vercel.app/stack-public/catalog)

Stack is a production-grade library platform built on Next.js 16, Neon Postgres, and the Vercel AI Stack. It handles everything a real library needs — catalog, circulation, members, holds, reporting — with three AI features that are governed end-to-end: budget-capped, observable via Langfuse, and gated behind per-feature kill switches. Built for the Valsoft Mini Library Management System Challenge.

---

## The brief, delivered

| Requirement | How Stack delivers it | Status |
|---|---|---|
| Add, edit, delete books with metadata | Full CRUD with soft-delete and Trash view; ISBN-13, authors, subjects, cover art, description, page count, publisher | Exceeded |
| Mark books checked out / checked in | Circulation: borrow, return, due-date tracking, renewals with policy limits, holds queue with promotion | Exceeded |
| Find books by title, author, or other fields | Lexical full-text search via Postgres `tsvector`; hybrid vector + lexical search with Reciprocal Rank Fusion built and governed | Exceeded |
| Deploy + live URL | Deployed on Vercel; Neon Postgres; live at the URL above | Met |
| Video demo | Script at `docs/demo/demo-script.md`; Loom recording linked in `docs/demo/` | Met |
| SSO auth with roles and permissions | Auth0 Organizations as tenant boundary; five roles (System Owner, Tenant Admin, Librarian, Member, Guest); CASL RBAC compiled per request from JWT | Exceeded |
| AI features | Three production AI features: ISBN enrichment, hybrid semantic search, Reader's Advisor conversational RAG with tool calls | Exceeded |
| Extra creative features | Multi-tenancy, public catalog URL, CSV bulk import with batch enrichment, member approval queue, natural-language reporting, AI-drafted email notifications | Exceeded |

---

## Three things that make Stack different

**1. A multi-tenant SaaS platform, not a single app.**
Every library that signs up gets a fully isolated instance — Auth0 Organization as the tenant boundary, request-scoped `SET LOCAL app.tenant_id` in every transaction, and Postgres Row-Level Security FORCE on every tenant table. A librarian at one library cannot see, search, or accidentally touch another library's data by any code path. The isolation is enforced at four independent layers so that a bug at any one layer is caught by the next. CI includes a cross-tenant isolation probe that fails the build if any query returns a row from the wrong tenant.

**2. Three production-grade AI features, governed end-to-end.**
Stack does not bolt an LLM onto the side of a CRUD app. Every AI call goes through a single gateway (`lib/ai/gateway.ts`) that enforces budget checks before the call, attaches Langfuse spans with tenant and feature tags, and routes through the Vercel AI Gateway. Each AI feature has a per-tenant monthly cost cap and a kill switch in Edge Config — disabling a feature requires no redeploy. Evals run as CI gates; the build fails if any feature drops below its quality threshold.

**3. Built by an AI-augmented SDLC.**
Stack demonstrates how an AI Engineering Manager would actually use AI inside the software development lifecycle: twelve EARS feature specs with BDD acceptance scenarios; AI implementation agents working test-driven (RED → GREEN → REFACTOR); a critic agent that reviews every change before a PR opens; eval gates in CI; AI-generated PR labels; provenance markers on AI-written docs. Every requirement traces brief → spec → test → CI job. The repo is a direct answer to the question the panel asked on the initial interview call.

---

## AI features

**ISBN-to-record enrichment.** Paste a 13-digit ISBN and Stack fans out to Open Library and Google Books in parallel, then an LLM normalizes the results into a single clean catalog record via `generateObject` with a Zod schema. The form auto-populates in roughly three seconds. Librarians review and confirm; they are never bypassed.

**Hybrid search.** Every book gets a `tsvector` for ranked keyword search and a 1,536-dimension pgvector embedding for semantic similarity. At query time, both rankings are fused with Reciprocal Rank Fusion. The "Books like this" affordance on the detail page queries by embedding proximity. The vector index and governance layer are fully built; embeddings for the seeded demo books are pending a batch enrichment run.

**Reader's Advisor.** A conversational RAG assistant at `/chat`, reachable from the `⌘K` palette or the nav rail. The model has four real tool calls: `search_catalog`, `get_book_detail`, `check_availability`, and `place_hold`. It returns actual books from the library's own catalog, renders them as clickable cards, and refuses off-catalog questions by design — the system prompt and a dedicated eval set both enforce this boundary. Every response is traced in Langfuse with `tenant_id`, `feature`, `model`, and `prompt_version`.

---

## AI inside the SDLC

**Spec-driven development.** Twelve feature specs in `project_docs/specs/` — each in EARS functional-requirement form with BDD acceptance scenarios, NFRs, edge cases, and a sign-off block. No spec, no implementation. Specs are frozen at sign-off; changes require a new spec or an ADR.

**AI implementation agents, TDD.** Builder agents implement one BDD scenario at a time: write the failing test, write the minimum code to pass, refactor. Each step is a discrete commit.

**AI code review as a gate.** A critic agent (critic-opus) reviews every change before a PR is opened: BDD-to-test coverage matrix, NFR enforcement, scope-creep check, security scan, design-alignment check. An APPROVED verdict is required; the CI pipeline checks for it.

**Evals as CI gates.** Braintrust eval sets run on every PR. The pipeline fails if any feature's score drops below its threshold or if the cross-tenant isolation probe returns a row from the wrong tenant. Prompt changes require a version bump and a passing eval before merge is permitted.

**AI PR labels.** A GitHub Actions step classifies each change and applies labels (`feature`, `fix`, `ai-change`, `migration`, `needs-safety-review`) so reviewers know what they are looking at before they open the diff.

**Provenance markers.** AI-authored documentation carries `<!-- written-by: writer-haiku | model: haiku -->`. Prompt files carry YAML frontmatter `version:` and `changed_in:` fields. Both are verified by CI.

**Full traceability.** Every requirement traces: assignment brief → spec requirement ID → BDD scenario → Vitest or Playwright test → CI job → deployment. The matrix is at `docs/analysis/05-requirements-traceability.md`.

---

## Architecture

**CQRS in Next.js primitives.** RSC pages and Route Handlers are queries — read-only, cached with tenant-scoped `cacheTag`. Server Actions (via `next-safe-action`) are commands — one Zod schema, one CASL permission check, one domain call, one audit log write in the same transaction. No tRPC, no GraphQL.

**Four-layer multi-tenant isolation.** (1) Auth0 middleware verifies the JWT and surfaces `org_id` and `roles[]`; (2) domain modules accept only a `TxClient`, never a raw connection; (3) every transaction opens with `SET LOCAL app.tenant_id = $1` (not `SET`, which would persist across pool connections); (4) Postgres RLS FORCE policies enforce tenant isolation at the database, independent of application code.

**AI Gateway as the single LLM entry point.** `lib/ai/gateway.ts` is the only permitted import for AI calls. It gates on `assertAiBudget`, attaches the Langfuse span, checks the feature kill switch, and routes through the Vercel AI Gateway. Direct SDK imports (`openai`, `@anthropic-ai/sdk`) are blocked by a Biome custom rule (`no-direct-llm-sdk`).

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Next.js 16 App Router on Vercel (Node functions; Edge for middleware) |
| Language | TypeScript 5.x (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| UI | shadcn/ui (Radix Primitives) + Tailwind CSS v4 + CSS design tokens |
| ORM | Drizzle ORM + drizzle-kit migrations |
| Database | Neon Postgres + pgvector + `tsvector` |
| Auth | Auth0 Organizations + `@auth0/nextjs-auth0` v4 |
| Authorization | CASL (`@casl/ability`) compiled per request from JWT |
| AI SDK | Vercel AI SDK v6 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) |
| AI Gateway | Vercel AI Gateway — routing, budgets, fallbacks, observability |
| AI Observability | Langfuse (prod tracing) + Braintrust (CI eval gates) |
| Background work | Vercel Workflow DevKit (durable, retryable) |
| Email | Resend + React Email templates |
| Validation | Zod 3 — actions, route handlers, AI tool args, AI structured output |
| Testing | Vitest (unit + integration) + Playwright (e2e) + Storybook 9 |
| Lint / Format | Biome (single binary, replaces ESLint + Prettier) |
| Error tracking | Sentry (tenant-tagged events) |
| CI/CD | GitHub Actions + Vercel (Neon branch per PR) |

---

## Getting started

**Prerequisites:** Node 20+, pnpm (via Corepack), a Neon Postgres database, an Auth0 tenant with Organizations enabled.

```bash
# 1. Clone
git clone https://github.com/your-org/valsoft-library.git
cd valsoft-library

# 2. Install dependencies
corepack enable
corepack pnpm install

# 3. Environment variables
cp .env.local.example .env.local
# Fill in: DATABASE_URL, AUTH0_SECRET, AUTH0_BASE_URL,
#           AUTH0_ISSUER_BASE_URL, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET

# 4. Apply migrations
corepack pnpm db:migrate

# 5. Seed the demo tenant ("Stack Public Library" — 45 books, 16 members)
corepack pnpm db:seed

# 6. Start the dev server
corepack pnpm dev
```

**Running without Auth0 locally:** add `DEV_AUTH_BYPASS=1` to `.env.local`. The middleware will use a hardcoded dev session with Librarian role. Do not use this flag in production.

---

## Testing

```bash
corepack pnpm test          # Vitest unit + integration
corepack pnpm test:e2e      # Playwright end-to-end (requires running dev server)
corepack pnpm typecheck     # tsc --noEmit
corepack pnpm biome:check   # lint + format check
corepack pnpm eval:gate     # Braintrust eval CI gate (requires BRAINTRUST_API_KEY)
```

Integration tests require `DATABASE_URL` pointing at a Neon test branch — see `.env.test.example`.

---

## Live demo

- **App (Auth0 login required):** [https://stacked-ivory.vercel.app](https://stacked-ivory.vercel.app)
- **Public catalog (no login):** [https://stacked-ivory.vercel.app/stack-public/catalog](https://stacked-ivory.vercel.app/stack-public/catalog)

The seeded demo tenant is "Stack Public Library" — 45 books with cover art, 16 members, active loans, an overdue cohort, a holds queue, and two pending member sign-ups in the approval queue. Log in via Auth0 with your Tenant Admin account to access the full librarian surface.

---

## Project structure

```
stack/
├── app/
│   ├── (public)/         # Public catalog — no auth required (Spec 09)
│   └── (app)/            # Authenticated surface: books, loans, members, chat, reports
├── lib/
│   ├── ai/               # Gateway, tools, prompts, budget, tracing
│   ├── auth/             # Auth0 wrappers, CASL ability builder
│   ├── db/               # Drizzle client, schema, withTenantTx, RLS SQL
│   └── domain/           # Pure TS domain modules — no HTTP, no Next imports
├── components/           # shadcn/ui components + app-specific compositions
├── drizzle/              # Generated migration SQL
├── evals/                # Braintrust eval sets and datasets
├── tests/                # unit/, integration/, e2e/
├── project_docs/specs/   # 12 EARS feature specs — the authoritative source of truth
└── docs/                 # Analysis, design system, ADRs, demo artifacts
```

Full annotated structure with naming conventions: `.claude/CLAUDE.md`.

---

## Further reading

- `project_docs/specs/00-INDEX.md` — feature inventory, reading order for hiring panel / implementing engineer / AI reviewer
- `project_docs/specs/12-sdlc-cicd-pipeline.spec.md` — the AI-augmented SDLC in detail
- `project_docs/specs/11-ai-governance.spec.md` — AI gateway, evals, budget caps, kill switches, cross-tenant probe
- `docs/demo/demo-script.md` — 7-minute walkthrough script (live demo or Loom recording)
- `docs/demo/presentation.html` — slide deck for the hiring panel presentation
