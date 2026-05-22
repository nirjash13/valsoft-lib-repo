# AI Changelog — Valsoft Library (Stack)

<!-- Machine-maintained changelog. Updated by /update-summary after significant changes. -->
<!-- Format: ## YYYY-MM-DD — Short Title -->
<!-- Each entry: what changed, files affected, decisions made. -->

## 2026-05-22 — Spec 07: Notifications (transactional + lifecycle emails, AI-drafted batch)

Closes the circulation loop with email: due-date reminders (T-2/T-0/T+1), hold-ready,
welcome, and rejection emails — plus an AI-draft batch composer with mandatory librarian
review. Engine: Resend + React Email. **Scheduling decision: hourly Vercel Cron, NOT Vercel
Workflow DevKit** (user-confirmed — consistent with the existing expire-holds cron, demoable
locally, idempotent via `outgoing_emails` dedup). NFR-07-02 workflow-durability is met
differently: the cron is stateless + idempotent, so a mid-run restart re-runs cleanly.

**Run 1A — schema (`drizzle/0010_notifications.sql`, applied to live DB):** two tenant-scoped
tables, RLS ENABLE+FORCE + policy + tenant-first indexes — `email_batches` (a sent-batch
record) and `outgoing_emails` (one row per send; `delivery_status` enum incl. `skipped_opt_out`
/`skipped_subject_removed`; `resend_id` for webhook correlation; `loan_id` for reminder dedup).
Column adds: `members.email_status` (ok|bouncing|complained), `members.lifecycle_emails_enabled`,
`tenants.email_monthly_cap` (default 5000).

**Run 1B — Resend + React Email:** `lib/notifications/email-client.ts` (`sendEmail` — real
Resend when `RESEND_API_KEY` set, DEV-OUTBOX console fallback when absent, never throws on a
missing key — mirrors the AI-gateway degrade pattern); React Email templates (`layout`,
`due-reminder`, `hold-ready`, `welcome`, `rejection`, `batch-reminder`); pure helpers
`interpolate` (mustache) + `unsubscribe-token` (HMAC-SHA256).

**Run 1C — AI draft:** `lib/notifications/ai-draft.ts` `draftPatronEmail` via
`generateObjectViaGateway` + `PatronEmailDraftSchema` (REQ-07-06); `assertAiBudget` pre-check;
**NFR-07-05 — the LLM receives aggregates + book titles + brand voice ONLY, never per-recipient
PII** (names interpolated at send time). `draft-validation.ts` flags missing `{{due_date}}` etc.

**Run 2 — email domain:** transactional + lifecycle senders, `volume-cap`, `reminders`
(3 date windows + `NOT EXISTS` dedup), post-commit `triggers` facade wired into
member-approve/reject + loan-return actions (try/catch — a failed email never rolls back the
mutation), `audience` preview, `send-batch` (chunks of 50).

**Run 3 — routes + UI:** `app/api/cron/send-reminders` (hourly, CRON_SECRET bearer +
kill-switch, mirrors expire-holds) + `vercel.json` cron entry; `app/api/webhooks/resend`
(hand-rolled Svix HMAC verify, delivery-status updates, bounce/complaint suppression,
503-on-missing-row race guard); public `app/unsubscribe` page (one-click, HMAC token);
`app/(app)/notifications` compose-batch UI + Server Actions (`email:compose`/`email:send`
CASL perms added) with live token-validation gating the Send button.

**Critic cycle:** REQUEST_CHANGES (2 HIGH/5 MEDIUM) → bug-fixer → APPROVE. Key fix: every
send path refactored so NO network `sendEmail` runs inside an open DB transaction
(load→send→record as short txs) — a mid-batch failure can no longer roll back the audit
rows of already-dispatched emails. Migration `0011_notifications_dedup` added a partial
unique index `(tenant_id, loan_id, email_type) WHERE loan_id IS NOT NULL` (concurrency-safe
reminder dedup) + `email_batches.updated_at`. 70/70 unit tests, typecheck + biome + build
(25 routes) green.

## 2026-05-22 — Spec 06: Reader's Advisor (conversational RAG chat with tool calls)

Headline AI feature: a grounded chat assistant that recommends ONLY this tenant's catalog
via tool calls, refuses off-catalog questions, and streams to two surfaces (⌘K + sidebar).

**Run 1A — chat schema (`drizzle/0009_chat.sql` + `.down.sql`, applied to live DB):** four
tenant-scoped tables, all RLS ENABLE+FORCE + policy + tenant-first composite index —
`chat_threads` (partial UNIQUE on `(tenant,member,page_context)` WHERE `archived_at IS NULL`
→ one active thread per member per page-context), `chat_messages` (FK→threads ON DELETE
CASCADE), `chat_refusals` (off_catalog|policy|error), `ai_usage` (token + cost rows —
groundwork for Spec 11 REQ-11-07). Schema files under `lib/db/schema/`.

**Run 1B — AI streaming + tools:** `lib/ai/routing.ts` (`MODELS` table — swappable gateway
slugs); `streamTextViaGateway` added to `lib/ai/gateway.ts` (telemetry on, gateway-only);
`lib/ai/prompts/readers-advisor.v1.md` (versioned system prompt — grounding, refusal,
`<book:UUID>` citation, empty-result fallback) + `load-prompt.ts` frontmatter parser;
`scripts/lint-prompts.mjs` + `pnpm lint:prompts`. Tool catalog `lib/ai/tools/` — 4 tools
(`search_catalog`, `get_book_detail`, `check_availability`, `place_hold`), each opens its
OWN `withTenantTx` (a stream outlives any single tx); `place_hold` CASL-gated on
`can('create','Hold')`, refuses gracefully.

**Run 2 — chat domain + route handler:** `lib/domain/chat/*` (thread/message/refusal/usage
persistence, pure `page-context` + `book-refs` + `refusal` helpers). `app/api/chat/stream/
route.ts` (`runtime=nodejs`): auth→401, kill-switch flag→404 (REQ-06-10), `assertAiBudget`→
402 (REQ-06-07), member resolution, get-or-create thread, `streamTextViaGateway` with the
tool catalog, `onFinish` persists messages + `ai_usage` + extracts book refs, friendly 503
on gateway failure (REQ-11-08).

**Run 3 — UI + evals:** `app/(app)/chat/*` + `components/chat/*` (`useChat` via
`@ai-sdk/react` 3.0.189 / `DefaultChatTransport`, streaming with `aria-live`, inline
`<book:UUID>`→`BookCardInline`, refusal notice, 402 quota banner, WCAG 2.2 AA); `components/
command-palette/*` (⌘K Radix overlay, 250 ms debounce, three options — Search / Ask Stack /
Place hold — REQ-06-01, "Ask Stack" hidden when flag off); sidebar "Ask Stack" entry;
`evals/readers-advisor.dataset.json` (25 dialogues 10/10/5 + 3 cross-tenant probes — CI
runner is Spec 11).

**Critic cycle:** REQUEST_CHANGES (3 HIGH, 1 MEDIUM) → bug-fixer → re-critic APPROVE.
H1 friendly-503 was dead code (`streamText` v6 never throws for gateway 5xx) → moved to
`toUIMessageStreamResponse({ onError })`. H2 `messages` was unvalidated server-side (`as
any[]`) → `safeValidateUIMessages` + 422 on bad shape + server-side 1000-char soft-truncate
(spec §9). H3 "0 tool calls ⇒ refusal" heuristic was unsound → `lib/domain/chat/refusal.ts`
`isRefusalText` (phrase-anchored, shared by route + `message-bubble`). M4 silent
`getOrCreateThread` `catch {}` → now logs. 63/63 unit tests, typecheck + biome +
lint:prompts + build (21 routes) green.

## 2026-05-22 — Spec 05: Search & Discovery (hybrid lexical + semantic + RRF)

**Run A — backend (25 files, ~770 LOC):**

- **Migration** — `drizzle/0008_search_discovery.sql` (+ `.down.sql`), hand-written, applied to live DB. Adds: `pg_trgm` + `vector` extensions; `books.tsv` weighted tsvector GENERATED column (A=title, B=authors, C=subjects, D=description); GIN index on `tsv`; trigram GIN indexes on title + authors; `book_embeddings` table (pgvector `vector(1536)`, HNSW cosine index, RLS FORCE, UNIQUE per `(tenant,book,model_version)` for rolling model cutover REQ-05-09); `search_zero_result_log` table (RLS FORCE).
- **Migration immutability fixes (orchestrator-applied):** `to_tsvector('english',…)` is only STABLE (regconfig lookup), and `array_to_string` is STABLE — both illegal in a GENERATED column / index expression. Wrapped in IMMUTABLE SQL functions: `books_search_tsv(text,text[],text[],text)` for the `tsv` column and `immutable_array_to_string(text[],text)` for the authors trigram index. `lexical-search.ts` updated to call `immutable_array_to_string` in the `%` and `similarity()` clauses so the trigram index applies.
- **Domain** — `lib/domain/search/{rrf,lexical-search,semantic-search,hybrid-search,books-like-this,compute-facets,log-zero-result,embed-book,schemas,errors}.ts`. RRF k=60; semantic cosine ≥ 0.30; lexical = `websearch_to_tsquery` primary + trigram fallback; soft-delete excluded query-level (REQ-05-04).
- **AI** — `lib/ai/gateway.ts` gains `generateEmbedding` routed through the Vercel AI Gateway; `assertAiBudget` before every embed.
- **Pipeline wiring** — `create-book.ts` / `update-book.ts` / `restore-book.ts` `// TODO (Spec 05)` comments replaced with live `embedBook` calls.
- **API** — `app/api/search/route.ts` (`POST /api/search`).

**Run B — UI (11 files, ~620 LOC):** `/search` RSC page (URL-driven state), `search-box` (250 ms debounce, 1-char guard, `useTransition`), `search-results` + cursor `load-more`, `facet-sidebar` (subject/availability/language/decade), `zero-results` state, "Books like this" rail on book detail, Search nav item.

**Critic cycle:** REQUEST_CHANGES (3 HIGH, 4 MEDIUM) → bug-fixer → re-critic APPROVE. Fixes: H1 dead `availability` facet now applies an `EXISTS`/`NOT EXISTS` on `loans.returned_at IS NULL` in all 3 query paths; H2 `embedBook` failure no longer rolls back catalog writes (try/catch+swallow at the 3 callers); H3 zero-result log moved to its own committed `db.transaction` (tenant GUC re-bound); M1 cursor gains `book_id` tiebreaker; M2 facet count `COUNT(DISTINCT…)` removes LEFT JOIN fan-out; M3 Route Handler error mapping `instanceof` not `constructor.name`; M4 year-chip single-`router.replace`. 52/52 unit tests, typecheck + biome + build green.

**Deferred (Spec 05 follow-ups):** `ts_headline` snippet highlighting; REQ-05-08 nearest-3 zero-result suggestions; integration tests (IT-05-*); eval set (`pnpm eval:search`, nDCG@5 ≥ 0.65 CI gate); public-catalog lexical-only mode (Spec 09); ⌘K (Spec 06); Workflow-based async re-embed backfill; `hybrid-search.ts` direct `db` import + stale `search-zero-result-log.ts` doc comment (LOW).

## 2026-05-22 — Spec 04 Run B + Spec 03 Run C + F-2 sweep: combined chain

**Spec 04 Run B — Member Management UI (16 files, ~1,460 LOC):** public self-signup (`app/signup/**` + `POST /api/members/signup`), librarian approval queue (`members/pending`), admin member list with status tabs, admin member edit (role + status + can_borrow), profile self-edit (`members/me`), `listMembers` domain query, `updateMemberAdminAction`, Members sidebar nav.

**Spec 03 Run C — Vercel Cron for `expireStaleHolds` (5 files):** `lib/db/with-system-tenant-tx.ts` (system path — re-binds `app.tenant_id` per tenant via `set_config`, no session, no BYPASSRLS), `lib/notifications/workflows/expire-stale-holds.ts` multi-tenant loop, `app/api/cron/expire-holds/route.ts` (`GET`, bearer-gated, per-tenant try/catch), `vercel.json` hourly cron `0 * * * *`, `lib/flags.ts` kill switch.

**F-2 design-token sweep (32 files + `components/books/isbn-banner.tsx`):** arbitrary `[hsl(var(--…))]` Tailwind classes → `@theme` utilities; F-9 extracted `IsbnBanner`; F-11 `aria-hidden` on visual required `*`. 9 alpha-modified tokens left `// REVIEW:` (need oklch/rgb @theme migration).

**Critic cycle:** REQUEST_CHANGES (3 HIGH, 7 MEDIUM) → bug-fixer. Fixes: H1 `crypto.timingSafeEqual` for the cron bearer check (was CWE-208); H2 member-edit OCC token now uses the DB-written `updatedAt` not a synthesized `new Date()`; H3 last-`tenant_admin` invariant extended to status changes (not just role); M1 `flags.test.ts` env cleanup; M4 member-list "All" tab; M5 read-only status for pending/rejected; M6 `?slug=` signup fallback gated to non-production. M2 (`app.user_id='system'`) and M3 (kill-switch polarity) rejected with justification.

**Smoke test / DB plumbing:** `DATABASE_URL` confirmed live (13/13 foundation checks). **Migrations 0006 (circulation) + 0007 (member-management) had never been applied** — both are hand-written; applied via `scripts/apply-migration.mjs`. New `scripts/seed-demo.mjs` + `pnpm db:seed:demo` + `pnpm db:seed` chain create the canonical demo tenant ("Stack Public Library", slug `stack-public`) with 8 books + 6 members (5 active + 1 pending). `seed-circulation.mjs` hardened to pick a tenant with ≥3 books + ≥3 active members (DB was full of leftover integration-test "Verify A/B" tenants). Seeded 2 loans (1 on-time, 1 overdue) + 1 queued hold. `pnpm build` green — 17 routes compile.

## 2026-05-22 — Spec 03 Run C: Critic fixes (H-1/M-5, H-2, H-3, H-4, M-1, M-2, M-3)

**Fixes applied per critic-opus review:**

- **H-1 + M-5** — `lib/auth/permission.ts:165`: granted `hold:delete` to `member` role. `lib/domain/holds/cancel-hold.ts`: added ownership check (reads hold before update; throws `HoldOwnershipDeniedError` when `callerMemberId` is set and doesn't match). `lib/domain/holds/errors.ts`: added `HoldOwnershipDeniedError` with `code: "HOLD_OWNERSHIP_DENIED"`. `lib/auth/safe-action.ts`: maps `HoldOwnershipDeniedError` → 403 `HOLD_OWNERSHIP_DENIED`. `app/(app)/holds/actions.ts`: `cancelHoldAction` resolves caller's member record and passes `callerMemberId` for non-staff callers. `app/(app)/holds/page.tsx:33`: `canReadAllHolds` now uses `ability.can("checkin","Loan")` as the staff discriminator (librarians have checkin; members don't); `canCancelHold` remains `ability.can("delete","Hold")` which is now true for members.
- **H-2** — `lib/db/schema/members.ts`: restored `auth0_user_id` (as `text`, nullable), `deleted_at` (timestamptz), changed `display_name`/`email` from `varchar` back to `text` — matching `0000_init.sql`. Running `drizzle-kit generate` should emit zero destructive diff.
- **H-3** — `lib/domain/loans/renew-loan.ts`: added `SELECT … FOR UPDATE` on the book row (step 5) before the hold-conflict check (step 6), serializing against concurrent `placeHold` calls.
- **H-4** — `lib/domain/holds/place-hold.ts`: added `SELECT … FOR UPDATE` on the book row as the first step, before `hasActiveLoan`, coordinating with `borrowBook` and `renewLoan`.
- **M-1** — `drizzle/0006_circulation.sql`: added safety comment block documenting the `safety:reviewed` PR label requirement for the `NOT NULL DEFAULT` backfill.
- **M-2** — `lib/domain/loans/renew-loan.ts`: hold-conflict query now adds `ne(holds.memberId, loan.memberId)` to exclude the borrower's own hold from blocking renewal.
- **M-3** — `scripts/seed-circulation.mjs:116`: changed audit action from `'loan.checked_out'` to `'loan.borrowed'` to match the domain function vocabulary.
- **Test** — `tests/unit/domain/holds/cancel-hold.test.ts`: one regression test for H-1/M-5 (member cancelling another member's hold throws `HoldOwnershipDeniedError`).

**Note (M-1):** `drizzle/0006_circulation.sql` requires the `safety:reviewed` GitHub PR label before merge. CI must be configured to block merge without this label (per `.claude/rules/migrations.md` §Per-PR safety).

## 2026-05-21 — Spec 03 Run A: Circulation backend (loans, holds, FIFO promotion, FOR UPDATE concurrency)

**What shipped (backend only, no UI — Run B will build the loans/holds pages):**

- **Schema** — new Drizzle tables `lib/db/schema/loans.ts` (checkedOutAt, dueAt, returnedAt, renewedCount, librarianId), `lib/db/schema/holds.ts` + `holdStatusEnum` (queued/ready/expired/cancelled). `lib/db/schema/_shared.ts` adds `MemberId`/`LoanId`/`HoldId` brands. `lib/db/schema/members.ts` rewritten with `memberStatusEnum` + `status` column + `updatedAt`; Spec 04 will re-add `auth0_user_id` + approval workflow.
- **Migration** — `drizzle/0006_circulation.sql` + `0006_circulation.down.sql` hand-written (DB unavailable in agent env). ALTER members + CREATE loans/holds with RLS `FORCE`, composite tenant-first indexes, partial UNIQUE on `(tenant_id, book_id, member_id) WHERE status IN ('queued','ready')` enforcing one-hold-per-member-per-book, partial index on `(tenant_id, book_id) WHERE returned_at IS NULL` for fast active-loan lookup.
- **Domain (loans)** — `lib/domain/loans/{borrow-book,return-book,renew-loan,list-loans-by-member,list-active-loans,has-active-loan,loan-policy,errors,schemas}.ts`. `borrow-book` does `SELECT ... FOR UPDATE` on the book row (NFR-03-02 concurrency safety) + withdrawn/active-loan/member-status guards. `renew-loan` uses optimistic concurrency via `expectedUpdatedAt` + hold-conflict + limit check. `has-active-loan` is no longer a stub — real Drizzle query; Spec 02 soft-delete now correctly refuses when a loan is active.
- **Domain (holds)** — `lib/domain/holds/{place-hold,cancel-hold,promote-next-hold,expire-stale-holds,list-holds-by-member,list-holds-by-book,errors,schemas}.ts`. `promote-next-hold` uses `FOR UPDATE SKIP LOCKED` (REQ-03-03 exactly-once promotion). `expire-stale-holds` is the worker entry point — `lib/notifications/workflows/expire-stale-holds.ts` stub wraps it pending Vercel Workflow trigger (Run C).
- **Server Actions** — `app/(app)/loans/actions.ts` (borrowBookAction, returnBookAction, renewLoanAction), `app/(app)/holds/actions.ts` (placeHoldAction, cancelHoldAction). All next-safe-action with `.metadata({ permission })` + revalidateTag invalidation on `loans`/`holds`/`books`.
- **CASL** — `lib/auth/permission.ts`: added `hold:delete` to librarian (REQ-03 spirit). `lib/auth/safe-action.ts`: 10 new error branches mapping every Spec 03 domain error → stable ProblemDetails `code` (BOOK_ALREADY_BORROWED 409, BOOK_WITHDRAWN 410, MEMBER_NOT_ACTIVE 403, LOAN_NOT_FOUND 404, LOAN_ALREADY_RETURNED 409, RENEWAL_LIMIT_REACHED 409, RENEWAL_BLOCKED_BY_HOLD 409, HOLD_NOT_FOUND 404, HOLD_ALREADY_EXISTS 409, HOLD_NOT_PLACEABLE 422).
- **Tests** — `tests/unit/domain/loans/loan-policy.test.ts`: 3 load-bearing tests on pure helpers (`computeDueAt` default + leap-year, `canRenew` truth table). 33/33 across 10 files.

**Smoke-test prep + NEW-1 fix landed in the same flow:**

- `lib/db/client.ts` — hardened `DATABASE_URL` validation. Now rejects placeholder values like `<neon-pooled-stack_app>` with a clear error pointing to the correct format (was: deep `TypeError: Invalid URL` inside the Neon Pool constructor).
- `lib/auth/permission.ts` — fixed NEW-1 (`auditlog:read` was being silently dropped because `parsePermission` title-cased it to `"Auditlog"` not `"AuditLog"`). Special-cased `"auditlog" → "AuditLog"` the same way `"ai" → "AI"`. `tests/unit/auth/ability.test.ts` adds a regression test asserting `buildAbility(["system_owner"]).can("read","AuditLog")` is true.
- `biome.json` — added `.claude/worktrees/**` and `next-env.d.ts` to ignore list (Next dev server regenerated next-env.d.ts with formatting biome rejected).

**Gates:** typecheck 0 errors, biome 0 errors (120 files), 33/33 unit tests, **integration tests + DB migration apply DEFERRED** (DB unavailable in agent env — see follow-ups).

**Deferred for Run B/C and Spec 04:**

- All five domain events (loan.checked_out, loan.returned, hold.placed, hold.promoted, hold.expired) are stub TODO comments — wired up in Spec 07 Notifications.
- 6 integration tests documented in `.claude/scratch/spec-03-runA/diff-summary.md` follow-ups — must run against a real Neon branch before merge (IT-03-1 borrow happy path, IT-03-2 return-promotes-hold, IT-03-3 double-borrow refused under FOR UPDATE, IT-03-4 renewal-refused-by-hold, IT-03-5 renewal-limit, IT-03-6 has-active-loan regression).
- Spec 04 must extend members with auth0_user_id + approval workflow + role linkage + can_borrow flag.
- Vercel Workflow scheduled trigger for `expireStaleHolds` is Run C.

## 2026-05-21 — Spec 02 Run B + B-fix: Books UI (design tokens, app shell, list/detail/new/edit/trash, ISBN preview)

**Run B (initial UI implementation):**

- **Design system** — `app/globals.css` (259 LOC): Tailwind v4 CSS-first config; `@theme` directive surfaces semantic tokens from `docs/design/design-system-brief.md` (--bg-canvas, --bg-surface, --accent, etc.); dark-mode default, light-mode hand-tuned; .glass-surface utility; type scale (text-display through text-blurb); reduced-motion collapse. `postcss.config.mjs` for @tailwindcss/postcss.
- **shadcn primitives** — `components/ui/{button,badge,input,textarea,label,separator,skeleton,dialog}.tsx` overridden to consume semantic tokens.
- **App shell** — `app/layout.tsx`, `app/(app)/layout.tsx` (Sidebar + TopBar + Sonner Toaster), `components/app/{sidebar,topbar}.tsx`. Glass top-bar (frosted backdrop-filter), dark/light theme toggle, disabled-with-tooltip nav for future Specs.
- **Dev-mode bypass** — `lib/auth/session.ts` + `middleware.ts`: `DEV_AUTH_BYPASS=1` env flag returns stub tenant_admin session (production-guarded). Without this, Auth0 Action not-yet-deployed blocks all local UI iteration.
- **Books pages** — `app/(app)/books/{page.tsx,books-search.tsx,[id]/page.tsx,[id]/book-actions.tsx,[id]/edit/{page.tsx,edit-book-form.tsx},new/{page.tsx,new-book-form.tsx},trash/{page.tsx,trash-table.tsx}}`. Card grid (160×240 3:4 covers), typographic gradient cover fallback, ISBN preview flow with sourcesDiff chips + LLM-normalization banner, optimistic-concurrency 409 banner, soft-delete + restore via confirmation dialogs.
- **Loading/error/not-found** — `app/(app)/books/{loading,error,not-found,[id]/loading}.tsx`. Skeleton primitives matching layout shapes; friendly error text with retry.
- **Utilities** — `lib/utils/{cn,cover-color,isbn-banner,problem}.ts`. `coverGradient(title)` (djb2 hash → 8-hue gradient, deterministic per title); `selectIsbnBanner(state)` (pure switch on PreviewState.kind, ts-not-tsx for vitest).
- **Tests** — `tests/unit/ui/{cover-color,isbn-banner}.test.ts`: 7 unit tests covering gradient determinism + 4 banner equivalence classes (BDD REQ-02-01 coverage).
- **Dependencies added** — `clsx`, `tailwind-merge`, `class-variance-authority`, `sonner`, `@radix-ui/react-{label,separator,dialog}`, `react-hook-form`, `@hookform/resolvers`.

**Run B-fix (5 fixes applied, per orchestrator self-review):**

- **F-1 (HIGH)** Replaced `text-[11px]` (below brief's 12px floor) with `text-caption` in `new-book-form.tsx:293` and `[id]/page.tsx:105`.
- **F-3 (MEDIUM)** `[id]/page.tsx` cover: removed `border border-[hsl(var(--border-subtle))]`; kept `elev-2`. Brief: shadow XOR border, never both.
- **F-4 (MEDIUM)** `components/app/sidebar.tsx`: accepts `canViewTrash: boolean` prop; `app/(app)/layout.tsx` computes server-side via `buildAbility(session.roles).can("delete", "Book")`. Trash entry hidden for non-admin (was visible-but-404 before).
- **F-5 (MEDIUM)** `lib/auth/session.ts`: dev bypass now reads `DEV_BYPASS_TENANT_ID` env first; logs resolved tenant once per process; throws new `DevBypassNoTenantsError` (in `lib/auth/errors.ts`) instead of silent zero-UUID fallback. Mapped to 503 in safe-action.ts.
- **F-6 (MEDIUM)** `lib/utils/problem.ts`: added `code?: string` to `ProblemDetails`. `lib/auth/safe-action.ts`: every `handleServerError` branch emits stable `code` (`OPTIMISTIC_CONCURRENCY`, `TENANT_NOT_PROVISIONED`, `BOOK_NOT_FOUND`, etc.). `edit-book-form.tsx:83`: switched detection from `err?.status === 409` to `err?.code === "OPTIMISTIC_CONCURRENCY"`. Disambiguates the two 409 cases.

**Gates (after fix run):**
- `pnpm typecheck` — 0 errors
- `pnpm biome check .` — 0 errors (98 files)
- `pnpm test:unit` — 27/27 passing across 9 files

**Deferred (recorded in active.yaml):**
- F-2 (MEDIUM, ~30-45min sweep) — components use `bg-[hsl(var(--bg-surface))]` arbitrary-value syntax instead of `@theme`-generated utilities. Pure refactor, ~30 files. Skipped from this fix run to keep diff reviewable.
- F-7 through F-12 (6 LOWs) — see active.yaml next_steps
- NEW-1 — `auditlog` is not in `AppSubject` union but `ROLE_PERMISSIONS` references `auditlog:read`. Pre-existing Spec 01 bug; emits warning during tests.
- NEW-2 — `.env.local.example` blocked by tool permissions; needs manual addition of `DEV_BYPASS_TENANT_ID=<uuid>` documentation line.

**Smoke test deferred** — agent has no live DB access. User must set `DEV_AUTH_BYPASS=1` + `DATABASE_URL` + `OWNER_DATABASE_URL` (optionally `DEV_BYPASS_TENANT_ID`) in `.env.local`, then `pnpm dev` and exercise the golden path: /books → New Book → 9780132350884 → preview → save → edit → soft-delete → Trash → Restore.

---

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
