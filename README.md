# Stack — Multi-Tenant SaaS Library Platform

Stack is a multi-tenant library management system built for Valsoft.
Each library is an isolated tenant; members of one library cannot see another's data.

**Feature specs:** [`project_docs/specs/00-INDEX.md`](project_docs/specs/00-INDEX.md)
**Architecture decisions:** [`docs/analysis/`](docs/analysis/) (private)
**Agent config + conventions:** [`.claude/CLAUDE.md`](.claude/CLAUDE.md)

---

## Tech stack

| Concern | Choice |
|---------|--------|
| Framework | Next.js 16 App Router on Vercel |
| Language | TypeScript 5.x (strict) |
| Database | Neon Postgres + pgvector |
| ORM | Drizzle ORM |
| Auth | Auth0 Organizations (Run B) |
| Authz | CASL (Run B) |
| Testing | Vitest + Playwright |
| Lint/format | Biome |

## Dev commands

```bash
pnpm install          # install dependencies
pnpm dev              # next dev (hot reload)
pnpm typecheck        # tsc --noEmit
pnpm biome:check      # lint + format check
pnpm test:unit        # vitest unit tests
pnpm test:integration # vitest integration (requires DATABASE_URL)
pnpm drizzle-kit generate  # generate migration SQL
pnpm drizzle-kit migrate   # apply migrations
```

## Setup

1. Copy `.env.local.example` to `.env.local` and fill in `DATABASE_URL` / `DATABASE_URL_UNPOOLED`.
2. Run `pnpm install`.
3. Apply the initial migration: `pnpm drizzle-kit migrate` (requires `DATABASE_URL_UNPOOLED`).
4. Run `pnpm dev`.

Auth0 env vars are not required until Run B.

---

**Current status:** Scaffold + Spec 01 Run A landed (foundation: `withTenantTx`, RLS migration, schema, DB client).
Run B (Auth0 wiring, CASL, audit writer, tenant provisioning) is next.
