# Stack — Project Stack Configuration

<!--
USAGE: Primary stack-specific reference for all agents working in this repository.
Project: Stack — multi-tenant SaaS library platform
Stack:   Next.js 16 (App Router) on Vercel + Neon Postgres + pgvector + Auth0 Organizations
         + Drizzle ORM + Vercel AI Gateway + Langfuse + Vercel Workflow DevKit
History: This file replaced the .NET 9 / Clean Architecture configuration on 2026-05-21
         after the stack-pivot decision (D-2026-05-21-stack-pivot). See `.claude/CHANGELOG_AI.md`
         and `docs/analysis/03-tech-stack-decisions.md` for full context.
-->

## Token Discipline (mandatory)
- Do not ask me to paste long logs/dumps/configs into chat.
- If you need large output, instruct me to save it to a file and reference it with @path.
- If I paste >150 lines or >10k characters, stop and ask me to move it into a file, then continue once I provide @file.
- Prefer running commands with output redirected to a file (e.g. `pnpm test > .claude/scratch/test.log 2>&1`) and then read the file.

## Always-Load Project Context
Before planning or coding, read:
- `.claude/CHANGELOG_AI.md` — machine-maintained changelog
- `.claude/memory/active.yaml` — current focus, blockers, recent decisions
- `.claude/memory/decisions.md` — locked architectural decisions
- `project_docs/specs/00-INDEX.md` — feature spec index
- The relevant `project_docs/specs/<NN>-<feature>.spec.md` for the feature you are working on

For human-readable architecture overview: `docs/analysis/01-radar-analysis.md` and `docs/analysis/03-tech-stack-decisions.md`.
For multi-tenant data design (RLS, `withTenantTx`, schema): `docs/analysis/04-multi-tenant-data-model.md`.

If architecture artifacts are missing or stale relative to the latest changes, run `/update-summary` before proceeding.
When making changes that affect architecture, API contracts, DB schema, workflows, or module responsibilities, update the relevant architecture files in the same PR.

---

## Runtime & Tooling

| Component         | Choice                                                                              |
|-------------------|-------------------------------------------------------------------------------------|
| Runtime           | Next.js 16 App Router on Vercel (Node functions; Edge for middleware only)          |
| Language          | TypeScript 5.x, `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Package Manager   | pnpm (workspaces if needed)                                                         |
| UI Library        | shadcn/ui (Radix Primitives) + custom theming                                       |
| Styling           | Tailwind CSS v4 + CSS variables for design tokens                                   |
| ORM               | Drizzle ORM + `drizzle-kit` migrations                                              |
| DB                | Neon Postgres + pgvector + `tsvector`                                               |
| DB Driver         | `@neondatabase/serverless` (HTTP) in functions; `node-postgres` Pool where long-lived |
| Validation        | Zod 3 — Server Action inputs, Route Handler bodies, AI tool args, AI structured output |
| Server Action lib | `next-safe-action` v8 (Zod parse + typed errors + auth middleware)                  |
| Auth              | Auth0 Organizations + `@auth0/nextjs-auth0` v4 (org_id + roles[] on JWT)            |
| Authz             | CASL (`@casl/ability`) — Ability compiled per request via ROLE_PERMISSIONS table    |
| Caching           | Next.js 16 Cache Components (`use cache` + `cacheTag` per tenant) + Vercel Runtime Cache |
| AI SDK            | Vercel AI SDK v6 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`)                      |
| AI Gateway        | Vercel AI Gateway — unified routing, budgets, fallbacks, observability              |
| AI Observability  | Langfuse (prod tracing) + Braintrust (CI eval gates)                                |
| Background work   | Vercel Workflow DevKit (durable, retryable)                                         |
| Email             | Resend + React Email templates                                                      |
| File storage      | Vercel Blob                                                                         |
| Test Runner       | Vitest (unit + Server Action) + Playwright (e2e on Neon preview branch) + Storybook 9 |
| Lint/Format       | Biome (single binary, replaces ESLint + Prettier)                                   |
| Error Tracking    | Sentry (Next 16 integration, tenant tag on every event)                             |
| Analytics/Flags   | Vercel Analytics + PostHog (feature flags double as AI kill switches)               |
| CI/CD             | GitHub Actions (tests, biome, eval gates) + Vercel (build & deploy + Neon branch per PR) |

> **Locked exclusions:** Redux/Zustand global state, tRPC, GraphQL, MediatR or other mediators, Prisma, Jest, ESLint + Prettier (replaced by Biome), microservices, BullMQ/Redis worker.

---

## Project Structure (Next.js 16 App Router + multi-tenant)

```
stack/
├── app/                              # Next.js App Router
│   ├── (public)/                     # Public catalog surface (Spec 09) — no auth
│   │   ├── [tenant]/catalog/page.tsx
│   │   └── layout.tsx
│   ├── (app)/                        # Authenticated app surface
│   │   ├── books/
│   │   │   ├── page.tsx              # RSC list (query)
│   │   │   ├── [id]/page.tsx         # RSC detail (query)
│   │   │   └── actions.ts            # Server Actions (commands)
│   │   ├── loans/
│   │   ├── members/
│   │   ├── chat/                     # Reader's Advisor (Spec 06)
│   │   └── layout.tsx
│   ├── api/
│   │   ├── chat/stream/route.ts      # Route Handler — AI streaming
│   │   ├── catalog/[tenant]/route.ts # Public read-only API
│   │   └── webhooks/.../route.ts
│   └── auth/                         # @auth0/nextjs-auth0 handlers
├── lib/
│   ├── auth/                         # Auth0 wrappers, session, JWT verify, CASL Ability builder
│   │   ├── session.ts
│   │   ├── ability.ts                # buildAbility(claims) → CASL Ability
│   │   └── middleware.ts             # next-safe-action auth middleware
│   ├── db/
│   │   ├── client.ts                 # Drizzle client + connection helpers
│   │   ├── schema/                   # *.ts — table definitions
│   │   ├── withTenantTx.ts           # the four-layer isolation wrapper
│   │   └── rls.sql                   # RLS policies applied by migrations
│   ├── domain/                       # Pure TS domain modules (no HTTP, no Next imports)
│   │   ├── books/
│   │   ├── loans/
│   │   ├── members/
│   │   └── search/
│   ├── ai/
│   │   ├── gateway.ts                # ONLY allowed entry point to LLMs
│   │   ├── routing.ts                # model routing table
│   │   ├── tools/                    # tool catalog (search_catalog, get_book_detail, …)
│   │   ├── prompts/*.md              # versioned prompts (frontmatter required)
│   │   ├── budget.ts                 # assertAiBudget(tenant_id, est_cost)
│   │   └── tracing.ts                # Langfuse span helpers
│   ├── notifications/                # Resend + React Email + Workflow handlers
│   ├── audit/                        # append-only audit_log writer
│   └── utils/
├── components/                       # shadcn/ui components + app components
│   └── ui/
├── drizzle/                          # migrations (generated SQL)
├── evals/                            # Braintrust eval sets + datasets
├── tests/
│   ├── unit/                         # Vitest — pure functions, domain modules
│   ├── integration/                  # Vitest — Server Actions hitting a Neon test branch
│   └── e2e/                          # Playwright
├── public/
├── project_docs/                     # feature specs (frozen post sign-off)
├── docs/                             # analysis, design, ADRs (private)
├── .claude/                          # agents, memory, scratch, slash commands
├── drizzle.config.ts
├── next.config.ts
├── biome.json
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── package.json
└── pnpm-lock.yaml
```

---

## Naming Conventions

| Element                       | Convention                | Example                                       |
|-------------------------------|---------------------------|-----------------------------------------------|
| Files (modules)               | kebab-case                | `with-tenant-tx.ts`, `create-book-action.ts`  |
| Route segments                | kebab-case                | `app/(app)/books/[id]/edit/page.tsx`          |
| React components              | PascalCase                | `BookCard.tsx`                                |
| Component file                | PascalCase OR kebab       | `book-card.tsx` exporting `BookCard` is OK    |
| Hooks                         | `use` prefix, camelCase   | `useDebouncedQuery`                           |
| Server Action functions       | camelCase verb-first      | `createBook`, `borrowBook`, `approveMember`   |
| Domain functions              | camelCase verb-first      | `enrichBookByIsbn`, `placeHold`               |
| Types / interfaces            | PascalCase, **no `I` prefix** | `BookRecord`, `LoanState`                 |
| Zod schemas                   | PascalCase + `Schema` suffix | `CreateBookSchema`                         |
| Drizzle table objects         | `snake_case` SQL name; camelCase TS export | `books` table → `export const books = pgTable("books", …)` |
| DB columns                    | snake_case                | `tenant_id`, `checked_out_at`                 |
| Env vars                      | SCREAMING_SNAKE_CASE      | `DATABASE_URL`, `AUTH0_CLIENT_SECRET`         |
| Constants                     | SCREAMING_SNAKE_CASE      | `MAX_RENEWAL_COUNT`                           |
| Test files                    | `*.test.ts` / `*.spec.ts` | `create-book-action.test.ts`                  |
| Commands (Server Actions)     | `{verb}{Noun}` action     | `createBook`, `softDeleteBook`                |
| Queries (RSC/Route Handler)   | `get{Noun}` / `list{Noun}` | `getBookById`, `listLoansByMember`           |
| Migrations                    | timestamped + descriptive | `2026_06_01_120000_add_books_tsvector.sql`    |

---

## Type Safety

### Required Patterns

```typescript
// ✅ tsconfig: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
// ✅ Prefer Zod schemas as the single source of truth; derive TS types via z.infer
import { z } from "zod";

export const CreateBookSchema = z.object({
  isbn13: z.string().regex(/^\d{13}$/),
  title: z.string().min(1).max(300),
  authors: z.array(z.string().min(1)).min(1),
  publishedYear: z.number().int().min(1450).max(new Date().getFullYear() + 1),
});
export type CreateBookInput = z.infer<typeof CreateBookSchema>;

// ✅ Branded IDs for cross-table safety
export type TenantId = string & { readonly __brand: "TenantId" };
export type BookId   = string & { readonly __brand: "BookId" };

// ✅ Readonly arrays in domain returns
export async function listBooks(): Promise<ReadonlyArray<BookRecord>> { /* … */ }

// ✅ Discriminated unions for state, never optional flags
export type LoanState =
  | { kind: "active";   checkedOutAt: Date; dueAt: Date }
  | { kind: "returned"; checkedOutAt: Date; returnedAt: Date }
  | { kind: "overdue";  checkedOutAt: Date; dueAt: Date };
```

### Forbidden

```typescript
// ❌ any — outside of a one-line cast at a third-party boundary, never
function handle(x: any) { /* … */ }

// ❌ Non-null assertion to silence the compiler
const tenantId = session.org_id!;  // verify-or-throw instead

// ❌ Mutating function arguments
function addRow(rows: Row[], row: Row) { rows.push(row); }  // return [...rows, row]

// ❌ Object spread to "fix" a type mismatch
const cmd = { ...input, tenant_id: "…" } as CreateBookCommand;  // build it properly via Zod

// ❌ Synchronous DB or fetch in Server Components without `cache()`/`use cache`
```

---

## Multi-Tenancy (THE critical pattern)

Every tenant-scoped read or write **must** go through `withTenantTx`. Direct `db.query.…` calls from a Server Action or Route Handler that touch tenant data are forbidden by ESLint custom rule `no-bare-db-call`.

### `withTenantTx` — the four-layer wrapper

```typescript
// lib/db/withTenantTx.ts (sketch — full impl per Spec 01)
import { db } from "@/lib/db/client";
import { getSession } from "@/lib/auth/session";
import type { TenantId } from "@/lib/types";

export async function withTenantTx<T>(
  fn: (tx: TxClient, ctx: TenantCtx) => Promise<T>,
): Promise<T> {
  const session = await getSession();        // Layer 1: Auth boundary
  if (!session) throw new UnauthorizedError();
  const tenantId = session.org_id as TenantId;

  return db.transaction(async (tx) => {
    // Layer 3: request-scoped tenant binding (SET LOCAL, NOT plain SET)
    await tx.execute(sql`SET LOCAL app.tenant_id = ${tenantId}::text`);
    // Layer 4 is in the database: every tenant table has RLS + FORCE
    return fn(tx, { tenantId, userId: session.sub, ability: session.ability });
    // commit/rollback handled by db.transaction
  });
}
```

### The four layers (Spec 01 §1)

1. **Auth boundary** — `@auth0/nextjs-auth0` middleware verifies JWT and surfaces `org_id` + `roles[]` (resolved to permissions by `lib/auth/permission.ts`).
2. **Repo guard** — domain modules accept a `TxClient` only; no module reaches for a bare connection.
3. **Request-scoped `SET LOCAL app.tenant_id`** — executed as the first statement of every transaction.
4. **RLS `FORCE` in Postgres** — every tenant table has `ALTER TABLE … FORCE ROW LEVEL SECURITY` and a policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.

Layer 4 catches mistakes that slip past Layers 1–3. CI runs a cross-tenant probe (Spec 01 NFR-01-02 + Spec 11 REQ-11-06) that fails the build if any query returns a row from another tenant.

### Forbidden

```typescript
// ❌ Plain SET (persists across PgBouncer pool — disaster)
await tx.execute(sql`SET app.tenant_id = ${tenantId}`);

// ❌ Bypassing withTenantTx in a Server Action
"use server";
export async function getBook(id: string) {
  return db.select().from(books).where(eq(books.id, id));  // NO — use withTenantTx
}

// ❌ Trusting client-supplied tenantId
export async function createBook(input: { tenantId: string; … }) { … }
// org_id ONLY comes from the verified JWT.
```

---

## Server Actions = Commands (CQRS)

Every command is a `next-safe-action` `actionClient.schema(…).action(…)` with Zod parsing, auth middleware, and a CASL permission check.

```typescript
// app/(app)/books/actions.ts
"use server";
import { actionClient } from "@/lib/auth/middleware";
import { CreateBookSchema } from "@/lib/domain/books/schemas";
import { withTenantTx } from "@/lib/db/withTenantTx";
import { createBookDomain } from "@/lib/domain/books/create-book";

export const createBook = actionClient
  .schema(CreateBookSchema)
  .metadata({ permission: "book:create" })   // CASL gate
  .action(async ({ parsedInput, ctx }) => {
    return withTenantTx(async (tx, { tenantId, userId }) => {
      const book = await createBookDomain(tx, { tenantId, userId, input: parsedInput });
      // audit log row written inside the same tx by the domain function
      return { id: book.id };
    });
  });
```

### Server Action rules

- **One Zod schema per action.** No untyped inputs.
- **Permission is metadata.** The auth middleware reads `metadata.permission` and runs `ctx.ability.can(action, subject)` — refuses with 403 `ProblemDetails` if false.
- **No HTTP work in the action.** Side effects (audit, cache invalidation, workflow trigger) happen in the domain function or after it returns.
- **Always return a typed result.** Either the success payload or a `{ serverError }` object (next-safe-action handles this).
- **Cache invalidation lives in the action.** After mutation: `revalidateTag(\`tenant:\${tenantId}:books\`)` etc.

## Route Handlers + RSC Fetches = Queries (CQRS)

```typescript
// app/(app)/books/page.tsx — RSC query
import { withTenantTx } from "@/lib/db/withTenantTx";
import { listBooks } from "@/lib/domain/books/list-books";

export default async function BooksPage({ searchParams }) {
  const books = await withTenantTx((tx, ctx) =>
    listBooks(tx, { tenantId: ctx.tenantId, query: searchParams.q })
  );
  return <BookList books={books} />;
}
```

```typescript
// app/api/catalog/[tenant]/route.ts — Route Handler (public catalog, lexical-only)
export async function GET(req: Request, { params }: { params: { tenant: string } }) {
  // Spec 09: ISR-cached, no LLM cost, no member data, no PII
  …
}
```

No tRPC. No MediatR. Server Actions are the command bus, RSC fetches + Route Handlers are the query bus.

---

## Drizzle Patterns

```typescript
// lib/db/schema/books.ts
import { pgTable, uuid, varchar, integer, timestamp, vector } from "drizzle-orm/pg-core";

export const books = pgTable("books", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  isbn13:         varchar("isbn13", { length: 13 }),
  title:          varchar("title", { length: 300 }).notNull(),
  publishedYear:  integer("published_year"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt:      timestamp("deleted_at", { withTimezone: true }),       // soft-delete (Spec 02)
  embedding:      vector("embedding", { dimensions: 1536 }),             // pgvector (Spec 05)
});
```

### Migrations

- Generate: `pnpm drizzle-kit generate` → produces SQL under `drizzle/`.
- Review the SQL diff manually before commit. The generated SQL is the contract.
- Apply in CI against a **Neon preview branch** before merging.
- Apply in prod via `pnpm drizzle-kit migrate` triggered by a Vercel build hook against the staging Neon branch first.
- Destructive migrations (DROP COLUMN/TABLE, NOT NULL backfills) require the `safety:reviewed` PR label (Spec 12 §6).

### RLS policy SQL (one-time, applied per tenant table)

```sql
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE books FORCE ROW LEVEL SECURITY;
CREATE POLICY books_tenant_isolation ON books
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

---

## AI Patterns (Spec 11)

### Rule 1: Vercel AI Gateway only

```typescript
// ✅ Right — through the gateway helper
import { generateText, streamText, generateObject } from "@/lib/ai/gateway";

// ❌ Forbidden — direct provider SDK (ESLint: no-direct-llm-sdk)
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
```

### Rule 2: Budget check **before** every call

```typescript
import { assertAiBudget } from "@/lib/ai/budget";

await assertAiBudget(tenantId, estimatedCostUsd);   // throws AiBudgetExceededError → 402
const result = await generateObject({
  schema: BookRecordSchema,
  prompt: …,
  experimental_telemetry: { isEnabled: true, functionId: "isbn-enrich" },
});
```

### Rule 3: Langfuse span on every call (Spec 11 REQ-11-02)

Spans are tagged `{ tenant_id, feature, model, prompt_version, user_id_hashed }`. The gateway helper handles this; do not roll your own tracing.

### Rule 4: Prompt files are versioned

```markdown
---
name: readers-advisor
version: 1.2
changed_in: PR#147
---
You are Stack's reading advisor. …
```

Any prompt-file change requires (a) version bump, (b) eval set passes at new version, (c) ADR in `docs/decisions/`. Enforced by CI (Spec 11 REQ-11-09).

### Rule 5: Kill switches at the edge

Every AI feature has an Edge Config flag `feature.<name>.enabled`. UI entry points + API routes both check it. Flipping the flag does not require a deploy.

```typescript
import { isFeatureEnabled } from "@/lib/flags";

if (!(await isFeatureEnabled("readers_advisor", tenantId))) {
  return Response.json({ error: "feature_disabled" }, { status: 404 });
}
```

### Rule 6: Refusal-by-design

Reader's Advisor (Spec 06) refuses off-catalog questions. Cross-tenant probes are part of every AI eval set (Spec 11 REQ-11-06). Build fails if a probe returns cross-tenant data.

---

## Validation (Zod + next-safe-action)

```typescript
// lib/domain/books/schemas.ts
import { z } from "zod";

export const CreateBookSchema = z.object({
  isbn13: z.string().regex(/^\d{13}$/, "ISBN must be 13 digits"),
  title:  z.string().min(1).max(300),
  authors: z.array(z.string().min(1)).min(1).max(20),
  publishedYear: z.number().int().min(1450).max(new Date().getFullYear() + 1).optional(),
});

// Used at three boundaries from a single source of truth:
//   1. Server Action input (next-safe-action .schema(CreateBookSchema))
//   2. AI tool argument schema (generateObject({ schema: BookRecordSchema, … }))
//   3. Client form parsing (react-hook-form + zodResolver)
```

---

## Error Handling

### Server Action errors → ProblemDetails-shaped client response

`next-safe-action` returns `{ serverError?: string, validationErrors?: …, data?: T }`. Server Actions never throw to the client — they return a typed envelope.

### Route Handler errors → RFC 7807 ProblemDetails

```typescript
// lib/http/problem.ts
export function problem(status: number, title: string, detail?: string) {
  return Response.json(
    { type: "about:blank", title, status, detail },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}
```

### Domain exception classes (typed, narrow)

```typescript
export class BookNotFoundError extends Error { constructor(public readonly bookId: string) { super(`Book ${bookId} not found`); } }
export class CrossTenantAccessError extends Error {}
export class AiBudgetExceededError  extends Error {}
export class PermissionDeniedError  extends Error { constructor(public readonly permission: string) { super(`missing permission: ${permission}`); } }
```

### Forbidden

```typescript
// ❌ Generic catch that swallows
try { … } catch (e) { console.log(e); }     // log + rethrow OR map to a typed error

// ❌ Throwing strings
throw "not found";                          // throw typed Error subclass

// ❌ try/catch around a Server Action call in a client component (next-safe-action handles it)
```

---

## Caching (Next.js 16 Cache Components)

```typescript
// Tenant-scoped read with cache tag for surgical invalidation
"use cache";
import { cacheTag } from "next/cache";

export async function listBooksCached(tenantId: TenantId, query: string) {
  cacheTag(`tenant:${tenantId}:books`);
  // RSC fetch …
}

// After a mutation invalidate the tag
import { revalidateTag } from "next/cache";
revalidateTag(`tenant:${tenantId}:books`);
```

Public catalog (Spec 09) uses ISR with `export const revalidate = 60;` per route segment.

---

## Background Work (Vercel Workflow DevKit)

```typescript
// lib/notifications/workflows/due-date-reminders.ts
import { defineWorkflow } from "@vercel/workflow";

export const dueDateReminderWorkflow = defineWorkflow({
  name: "due-date-reminders",
  async run({ step, payload }: { step: …, payload: { loanId: string, tenantId: TenantId } }) {
    const loan = await step.do("fetch-loan", () => withTenantTx((tx, _) => getLoanById(tx, payload.loanId)));
    await step.sleepUntil("t-minus-2", new Date(loan.dueAt.getTime() - 2 * 24 * 60 * 60 * 1000));
    await step.do("send-t-minus-2-email", () => sendReminder(loan, "T-2"));
    // … T-0, T+1
  },
});
```

Workflow handlers **must re-establish** `app.tenant_id` via `withTenantTx` before any DB access — they don't inherit it from the triggering request.

---

## Testing

> The canonical testing policy is `.claude/rules/testing.md` — load-bearing tests only, the four-question filter, hard ceilings for bug fixes. Read it before writing tests.

### Unit test (Vitest)

```typescript
// tests/unit/domain/books/create-book.test.ts
import { describe, it, expect } from "vitest";
import { validateIsbnChecksum } from "@/lib/domain/books/isbn";

describe("validateIsbnChecksum", () => {
  it("accepts a known-good ISBN-13", () => {
    expect(validateIsbnChecksum("9780132350884")).toBe(true);    // Clean Code
  });

  it("rejects a checksum mismatch", () => {
    expect(validateIsbnChecksum("9780132350885")).toBe(false);
  });
});
```

### Integration test (Vitest + Neon test branch)

```typescript
// tests/integration/actions/create-book.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { setupTestTenant, teardown } from "../helpers/tenant";
import { createBook } from "@/app/(app)/books/actions";

describe("createBook (integration)", () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await setupTestTenant(); });

  it("creates a book and writes audit_log atomically", async () => {
    const result = await ctx.runAs(ctx.librarian, () =>
      createBook({ isbn13: "9780132350884", title: "Clean Code", authors: ["Robert Martin"] })
    );
    expect(result?.data?.id).toBeDefined();

    const audit = await ctx.db.select().from(auditLog).where(eq(auditLog.subjectId, result.data.id));
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("book.created");
  });

  it("refuses cross-tenant book access", async () => {
    const other = await setupTestTenant();
    const result = await other.runAs(other.librarian, () => getBookById(ctx.someBookId));
    expect(result.data).toBeUndefined();   // RLS hides the row
  });
});
```

### E2E test (Playwright on Neon preview branch)

```typescript
// tests/e2e/borrow-flow.spec.ts
import { test, expect } from "@playwright/test";

test("librarian borrows a book on behalf of a member", async ({ page }) => {
  await page.goto("/books");
  …
});
```

---

## Common Commands

```bash
# Dev
pnpm install
pnpm dev                                # next dev
pnpm build                              # next build
pnpm start                              # next start

# Database
pnpm drizzle-kit generate               # generate migration SQL from schema
pnpm drizzle-kit migrate                # apply migrations
pnpm db:seed                            # seed demo tenant + 5 pre-seeded accounts (Spec 04)
pnpm db:reset                           # truncate + reseed (dev only)
pnpm db:branch <name>                   # create Neon branch (uses Neon CLI)

# Testing
pnpm test                               # vitest run --reporter=verbose
pnpm test:unit                          # tests/unit/**
pnpm test:integration                   # tests/integration/** (requires DATABASE_URL pointing at a Neon test branch)
pnpm test:e2e                           # playwright test
pnpm test:coverage                      # vitest --coverage

# Quality
pnpm biome check .                      # lint + format check
pnpm biome check --write .              # apply fixes
pnpm typecheck                          # tsc --noEmit
pnpm lint:prompts                       # custom: verify prompt frontmatter versions

# AI / evals
pnpm eval                               # run Braintrust eval suite locally
pnpm eval:gate                          # CI gate version — exits non-zero if any feature below threshold

# Storybook
pnpm storybook
pnpm build-storybook

# Deployment
pnpm vercel pull                        # pull env vars
pnpm vercel deploy                      # preview deploy
pnpm vercel deploy --prod               # production
```

---

## Framework-Specific Patterns

### Route Handler

```typescript
// app/api/chat/stream/route.ts
import { streamText } from "@/lib/ai/gateway";
import { getSession } from "@/lib/auth/session";
import { assertAiBudget } from "@/lib/ai/budget";
import { isFeatureEnabled } from "@/lib/flags";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";     // explicit; Edge does not run pg

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return problem(401, "Unauthorized");

  if (!(await isFeatureEnabled("readers_advisor", session.org_id))) {
    return problem(404, "Not Found");
  }

  const { messages } = await req.json();
  await assertAiBudget(session.org_id, /* est */ 0.02);

  return streamText({
    model: "claude-sonnet-4.6",
    messages,
    tools: { searchCatalog, getBookDetail, checkAvailability, placeHold },
    experimental_telemetry: { isEnabled: true, functionId: "readers_advisor" },
  }).toDataStreamResponse();
}
```

### Middleware (Edge)

```typescript
// middleware.ts
import { NextResponse } from "next/server";
import { withAuth0 } from "@auth0/nextjs-auth0/edge";

export default withAuth0(async (req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/catalog") || url.pathname.startsWith("/(public)")) {
    return NextResponse.next();   // public surface — no auth
  }
  // … tenant inference from subdomain or Auth0 org claim, redirect to login if unauth'd
});

export const config = { matcher: ["/((?!_next|favicon.ico|assets).*)"] };
```

### Dependency wiring

Next.js doesn't have an Inversion-of-Control container. Dependencies are imported at module load:

- `lib/db/client.ts` exports the Drizzle client.
- `lib/auth/session.ts` exports `getSession()`.
- `lib/ai/gateway.ts` exports `generateText`, `streamText`, `generateObject`.
- Server Actions and Route Handlers import these directly.

Tests substitute via `vi.mock()` at the module path. No constructor injection.

---

## What we're NOT using (and why)

| Tech                    | Why not                                                                                |
|-------------------------|----------------------------------------------------------------------------------------|
| .NET / EF Core / MediatR | Stack pivot D-2026-05-21-stack-pivot. Vercel does not host .NET.                       |
| tRPC                    | Server Actions + RSC fetches give end-to-end types without the extra layer.            |
| GraphQL                 | Not justified at this scale; would add schema duplication.                             |
| Prisma                  | Drizzle is SQL-native, lighter, easier RLS integration on Neon.                        |
| Jest                    | Vitest is faster and ESM-friendly under Next 16.                                       |
| ESLint + Prettier       | Replaced by Biome (single binary).                                                     |
| Supabase                | Auth0 is locked; Supabase would replace it and force a different auth shape.           |
| Redux / Zustand global  | RSC + URL state + local `useReducer` cover the needs.                                  |
| LangChain.js            | Vercel AI SDK + Gateway is lighter and integrates directly with our routing/eval story.|
| BullMQ + Redis          | Vercel Workflow DevKit replaces queue + worker + scheduler in-stack.                   |

---

## Provenance markers

Documents and migrations authored by AI agents must carry the appropriate marker:

- `<!-- written-by: writer-haiku | model: haiku -->` for `docs/**` (per `.claude/rules/docs.md`).
- Migration SQL files: leave them un-marked but commit them through a PR; CI verifies generated-vs-checked-in match.
- Prompt files: YAML frontmatter `version:` + `changed_in:` PR reference is the provenance marker.
