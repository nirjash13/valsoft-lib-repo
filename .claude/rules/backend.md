# Backend Rules

## Scope
Applies when editing backend / server-side code under `app/**`, `lib/**`, and `drizzle/**` — Server Actions, Route Handlers, domain modules, repositories, AI infrastructure, workflows.

## Architecture Boundaries (mandatory)

Stack uses CQRS realised in Next.js primitives, not a Clean-Architecture project split. The dependency rule is therefore expressed by **module shape**, not project boundaries:

```
app/(app)/**/page.tsx     ─── RSC queries  ──┐
app/(app)/**/actions.ts   ─── Commands   ────┼──► lib/domain/**  ──► lib/db/** + lib/ai/**
app/api/**/route.ts       ─── queries/cmds ──┘
```

- **`lib/domain/**`**: Pure TS modules. No `next/*` imports, no `@auth0/nextjs-auth0`, no HTTP. Accept a `TxClient` and a `TenantCtx` from the caller. Return values, throw typed errors.
- **`lib/db/**`**: Drizzle schema + `withTenantTx` wrapper + RLS SQL. The single place a connection is opened.
- **`lib/ai/**`**: AI Gateway helpers, prompts, tools, budget, tracing. The single permitted path to LLMs.
- **`app/(app)/**/actions.ts`**: Server Actions wrapped in `next-safe-action`. One schema, one permission, one domain call.
- **`app/(app)/**/page.tsx`** (RSC): RSC queries through `withTenantTx`. No mutations here.
- **`app/api/**/route.ts`**: Route Handlers — used for streams (chat), webhooks, public read-only endpoints.

### Forbidden cross-module references

```
❌ lib/domain/** importing from app/** or next/* or @auth0/**
❌ app/(app)/**/page.tsx writing to the DB (queries only — commands go in actions.ts)
❌ Server Actions or Route Handlers opening a raw db connection (must go through withTenantTx)
❌ Any file outside lib/ai/** importing a provider SDK (openai, @anthropic-ai/sdk, …)
❌ Drizzle queries that reference a tenant-scoped table without an enclosing withTenantTx
```

ESLint / Biome custom rules enforce: `no-bare-db-call`, `no-direct-llm-sdk`, `no-set-app-tenant-id` (forbids plain `SET`, requires `SET LOCAL`).

## Standards

- Validate all external input at the Server Action / Route Handler boundary using Zod (`next-safe-action .schema()`).
- All tenant-scoped reads and writes go through `withTenantTx(async (tx, ctx) => …)`.
- Server Actions declare their required permission via `.metadata({ permission: "subject:action" })`; the auth middleware compiles a CASL Ability from the JWT and gates the call.
- Every authoritative mutation writes an `audit_log` row **inside the same transaction** (Spec 01 REQ-01-06).
- Use `Date` consistently for timestamps — never raw string arithmetic. Persist as `timestamptz`.
- AI calls go through `lib/ai/gateway.ts` only and are preceded by `await assertAiBudget(tenantId, estimateUsd)` (Spec 11 REQ-11-03).
- Background work uses Vercel Workflow DevKit; workflow steps re-establish `app.tenant_id` via `withTenantTx`.
- Public surfaces (Spec 09 catalog, sitemap, OG image) must not invoke LLMs and must not touch tenant-private data — they read `reporting.public_books` views only.
- Cache invalidation is the caller's responsibility — after a Server Action mutates, call `revalidateTag(\`tenant:\${tenantId}:<entity>\`)`.

## Verification

- `pnpm typecheck` — zero errors.
- `pnpm biome check .` — zero issues.
- `pnpm test:unit` and `pnpm test:integration` — targeted to changed behaviour. Integration tests run against a disposable Neon branch.
- `pnpm lint:prompts` if any file under `lib/ai/prompts/**` changed.
- `pnpm eval:gate` if any AI prompt or routing change is in the diff.

## References

- `.claude/CLAUDE.md` — full Next.js stack patterns and naming conventions.
- `project_docs/specs/01-foundation-multi-tenancy-auth.spec.md` — `withTenantTx`, RLS, CASL, audit log details.
- `project_docs/specs/11-ai-governance.spec.md` — AI Gateway routing, Langfuse spans, budget checks, kill switches.
- `docs/analysis/04-multi-tenant-data-model.md` — schema and isolation deep-dive.
