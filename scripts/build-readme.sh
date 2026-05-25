#!/usr/bin/env bash
# Assemble the README.md deliverable from existing README front matter
# + 13 portfolio docs (skipping 10 Engineering Leadership Playbook)
# + existing operational sections at the bottom.
#
# Headings in each portfolio doc are demoted by one level so the resulting
# README has a single H1, with each doc as an H2 section.
#
# Cross-link sections (References, Cross-Links, Cross-references, Where-to-read-next)
# are stripped, since the README contains all the content inline.
#
# Provenance comments are stripped since this is the consolidated deliverable.
#
# Code-block fences (``` ... ```) are tracked so headings inside code blocks
# are NOT demoted (they are example markdown, not real sections).

set -euo pipefail

DOCS_DIR="docs/portfolio"
OUTPUT="README.md.new"

# Order: 10 Engineering Leadership Playbook is skipped per user request.
DOCS=(
  "01-executive-brief"
  "02-c4-architecture"
  "03-ai-platform-architecture"
  "04-data-architecture"
  "05-security-architecture-and-threat-model"
  "06-api-contracts"
  "07-decision-matrices"
  "08-ai-model-selection"
  "09-sdlc-with-ai"
  "11-ai-governance-framework"
  "12-quality-reliability-observability"
  "13-risk-register"
  "14-finops-and-scaling"
)

process_doc() {
  local file=$1
  awk '
    BEGIN { in_code = 0; skip_section = 0 }

    # Track fenced code blocks so headings inside them are left alone.
    /^```/ {
      in_code = !in_code
      print
      next
    }

    # Strip the provenance HTML comment.
    /<!-- written-by:/ { next }

    # Start of a cross-link / references section (only outside code blocks).
    !in_code && /^## (Cross[- ]?[Rr]eferences|Cross[- ]?[Ll]inks|References|Architecture References|Where to read next)/ {
      skip_section = 1
      next
    }

    # Any next ## heading (outside code) ends the skipped section.
    !in_code && /^## / {
      skip_section = 0
    }

    # If we are in a skipped section, drop the line.
    skip_section { next }

    # Demote headings by one level (only outside code blocks).
    !in_code && /^#+ / {
      new_line = "#" $0
      sub(/^## Stack — /, "## ", new_line)
      print new_line
      next
    }

    { print }
  ' "$file"
}

{
  cat << 'FRONTMATTER_EOF'
# Stack — Library Platform

**A multi-tenant library management SaaS where every library gets its own private, AI-native instance.**

Live: [https://stacked-ivory.vercel.app](https://stacked-ivory.vercel.app) · Public catalog (no login): [https://stacked-ivory.vercel.app/stack-public/catalog](https://stacked-ivory.vercel.app/stack-public/catalog)

Stack is a production-grade library platform built on Next.js 16, Neon Postgres, and the Vercel AI Stack. It handles everything a real library needs — catalog, circulation, members, holds, reporting — with three AI features that are governed end-to-end: budget-capped, observable via Langfuse, and gated behind per-feature kill switches. Built for the Valsoft Mini Library Management System Challenge.

This README is a single, self-contained deliverable. It opens with the brief-delivered table, then walks through the full engineering portfolio — architecture, decisions, AI governance, operations, risk, and cost — in a structure designed for the Valsoft Corporation hiring panel to read end-to-end or jump to any specific concern via the Table of Contents.

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

## Table of Contents

**Portfolio — engineering depth for the hiring panel:**

1. [Executive Brief](#executive-brief) — Product positioning, market gap, AI strategy, success criteria, 90-day plan
2. [C4 Architecture (L1–L3)](#c4-architecture-levels-13) — System context, container, and component diagrams; sequence diagrams
3. [AI Platform Architecture](#ai-platform-architecture) — Gateway, prompt versioning, evals, guardrails, RAG, kill switches
4. [Data Architecture & Multi-Tenancy](#data-architecture--multi-tenancy) — Four-layer RLS isolation, schema, hybrid search, audit
5. [Security Architecture & Threat Model](#security-architecture--threat-model) — STRIDE table, controls matrix, AuthN/AuthZ
6. [API Contracts](#api-contracts) — Server Actions catalogue, Route Handlers, AI streaming, OpenAPI fragment
7. [Decision Matrices](#decision-matrices) — Scoring matrices for ORM, Auth, AI gateway, observability, background work
8. [AI Model Selection](#ai-model-selection) — Per-feature model choice with quality / cost / latency / safety scoring
9. [SDLC with AI](#sdlc-with-ai-how-ai-augments-software-delivery-end-to-end) — How AI is woven into each phase of the dev lifecycle
10. [AI Governance Framework](#ai-governance-framework) — 15-policy catalogue, eval gates, budget caps, compliance posture
11. [Quality, Reliability & Observability](#quality-reliability--observability) — SLOs/SLIs, error budgets, dashboards, runbooks
12. [Risk Register & Mitigations](#risk-register--mitigations) — 38 risks across 5 categories, scored L×I, heatmap
13. [FinOps & Scaling](#finops--scaling) — Cost model, per-tenant ceilings, scaling roadmap 10 → 10k tenants

**Operational — for engineers running or extending the codebase:**

- [Getting Started](#getting-started)
- [Testing](#testing)
- [Live Demo](#live-demo)
- [Project Structure](#project-structure)

---

FRONTMATTER_EOF

  for doc in "${DOCS[@]}"; do
    process_doc "$DOCS_DIR/$doc.md"
    printf '\n---\n\n'
  done

  cat << 'OPERATIONAL_EOF'
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
│   ├── (public)/         # Public catalog — no auth required
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
└── docs/                 # Analysis, design system, ADRs, demo artifacts, and portfolio
```

Full annotated structure with naming conventions: `.claude/CLAUDE.md`.
OPERATIONAL_EOF

} > "$OUTPUT"

mv "$OUTPUT" README.md
echo "README.md built: $(wc -l < README.md) lines"
