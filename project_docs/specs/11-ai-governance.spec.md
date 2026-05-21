<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 11 — AI Governance, Observability, Evals & Cost Control (Cross-Cutting)

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies assignment:** Bonus 3.4 done responsibly, plus interview-call signal on "AI in production."
**Architecture refs:** [02 AI Features](../../docs/analysis/02-ai-features-research.md) §Observability, §Cost controls, §Risk register · [03 Tech Stack](../../docs/analysis/03-tech-stack-decisions.md) §AI Gateway, §Evals, §Tracing

---

## 1. What this feature is

This spec defines the cross-cutting AI platform that every AI-using feature (Specs 02, 05, 06, 07, 08, 10) depends on. There is no UI surface here directly — this is the infrastructure beneath the UI. Six concerns:

1. **Model routing** via Vercel AI Gateway — one config, easy fallback, central budget.
2. **Tracing** via Langfuse — every model + tool call recorded with tenant/feature/user tags.
3. **Eval gates** in CI — feature-specific eval sets fail the build below threshold.
4. **Cost caps** per tenant per month — enforced **before** any AI call.
5. **Kill switches** per feature in Vercel Edge Config — turn off a misbehaving feature without redeploy.
6. **Refusal correctness + cross-tenant probe** baked into the eval suite.

> **Value beyond the brief.** Not asked. We deliver the full production-AI operating surface — exactly what the AI Engineering Manager at Valsoft would be expected to build for AI Labs' portfolio: feature toggles, per-tenant budgets, traces, evals, kill switches. **This is what "AI done responsibly" actually looks like.**

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **AI Gateway** | Vercel's central proxy for LLM providers. Routes, budgets, and traces every call. |
| **Langfuse** | Open-source LLM tracing/observability tool. Self-hostable; we use the SaaS for v1. |
| **Eval gate** | A CI job that runs scripted dialogues against the actual prompts/models and fails the build if quality drops below threshold. |
| **Edge Config** | Vercel's read-optimized configuration store, available in middleware and edge functions. Used for feature flags + kill switches. |
| **Cost cap** | Per-tenant per-month USD limit, checked *before* any AI call. |
| **Refusal correctness** | The metric that measures whether the assistant refuses what it should refuse and answers what it should answer. |
| **Cross-tenant probe** | An eval scenario that intentionally tries to get an answer that would require data from another tenant; expected: refused or empty. |

## 3. Concerns × tools

| Concern | Tool | Notes |
|---------|------|-------|
| Routing & failover | Vercel AI Gateway | Sonnet 4.6 default; Haiku for cheap calls; GPT-5.5 / Cohere as fallbacks |
| Tracing | Langfuse | Spans tagged `tenant_id, feature, model, prompt_version, user_id` |
| Evals | Braintrust (CI gate) | Hand-curated per-feature eval sets in `evals/` |
| Cost cap | Custom middleware backed by `ai_usage` table | Pre-call check; over-cap → 402 |
| Kill switch | Edge Config | One flag per feature; flipped without redeploy |
| Provenance | Prompt files versioned in repo | Hashes captured per span |

## 4. User stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a **tenant admin**, I need a monthly AI cap so I'm not surprised by the bill. | Must |
| US-02 | As a **platform on-call**, I need to disable any AI feature without a deploy if it misbehaves. | Must |
| US-03 | As an **AI reviewer**, I need eval gates in CI so prompt changes can't silently regress quality. | Must |
| US-04 | As an **AI reviewer**, I need cross-tenant probes in the eval suite so isolation can't silently regress. | Must |
| US-05 | As a **platform engineer**, I need every model and tool call traced with tenant + feature tags so I can investigate incidents. | Must |
| US-06 | As an **AI reviewer**, I need to swap models via config — no code change — when a better one ships. | Must |
| US-07 | As a **finance/admin**, I need a portfolio (cross-tenant) AI cost roll-up. | Should (Spec 08 platform dashboard) |
| US-08 | As a **member**, I need a clear message when AI is unavailable (not a generic 500). | Must |

## 5. Functional requirements (EARS)

```
REQ-11-01: When any feature invokes an LLM or embedding, the system shall route through Vercel AI Gateway using
the routing table in `lib/ai/routing.ts`; direct provider SDK use shall be forbidden by ESLint custom rule.

REQ-11-02: When any model/tool call begins, the system shall open a Langfuse span tagged
{ tenant_id, feature, model, prompt_version, user_id_hashed, parent_span_id? }; the span shall capture
start_ts, end_ts, prompt_tokens, completion_tokens, cost_usd, latency_ms, error?.

REQ-11-03: When any AI feature is about to invoke the gateway, the system shall first call
`assertAiBudget(tenant_id, estimated_cost_usd)` which (a) reads month-to-date spend from `ai_usage`, (b) reads
the tenant cap from `tenants.ai_monthly_cap_usd`, (c) refuses with `AiBudgetExceededError` if MTD + estimate >
cap; the caller returns 402 to the UI.

REQ-11-04: When the `feature.<name>.enabled` flag in Edge Config is `false`, the system shall (a) hide UI entry
points, (b) reject API requests with 404 (not 503), (c) trace the rejection as a `feature_disabled` span.

REQ-11-05: When CI runs, the system shall execute the eval suite under `evals/` against the production prompts +
default routing; the build shall fail if any feature scores below its declared threshold (Spec-defined in 05, 06,
07, 08).

REQ-11-06: When CI runs the eval suite, it shall include the cross-tenant probe — at least one eval per AI
feature that attempts to elicit data from another tenant — and fail the build if any probe returns other-tenant
data.

REQ-11-07: When an `ai_usage` row is written, the system shall write inside the same Server Action transaction
that triggered the AI call; failure to write `ai_usage` shall not roll back the user-visible action, but shall
log a high-priority alert.

REQ-11-08: While the Gateway returns 5xx or times out, when a feature invokes a model, the system shall fail-fast
with a friendly error ("AI is temporarily unavailable") — no in-app retries beyond Gateway's own.

REQ-11-09: When a prompt file (`lib/ai/prompts/*.md`) changes in a PR, CI shall (a) require the file to have a
new `version: x.y` frontmatter, (b) require the matching eval set to pass at the new version, (c) require an
ADR entry under `docs/decisions/`.

REQ-11-10: When the Langfuse SaaS is unreachable, the system shall buffer spans locally up to 1,000 entries and
flush when connectivity returns; spans dropped on overflow shall be counted in a metric.
```

## 6. Acceptance scenarios (BDD)

### REQ-11-01 — direct SDK forbidden
- **Given** a developer imports `import OpenAI from 'openai'` in a feature module
- **When** ESLint runs
- **Then** the build fails with `no-direct-llm-sdk: route via lib/ai/gateway.ts`
- **And** PR is blocked.

### REQ-11-02 — span tagging
- **Given** a Reader's Advisor request from member M at tenant A
- **When** the chat span closes
- **Then** Langfuse shows one span tagged `tenant_id=A, feature=readers_advisor, model=claude-sonnet-4.6, prompt_version=v1.0, user_id_hashed=sha256(M)`
- **And** the inner tool spans inherit `tenant_id` and `feature`.

### REQ-11-03 — cap enforcement
- **Given** tenant A has cap $50 and MTD spend $49.50
- **When** a Reader's Advisor chat is requested with estimated cost $0.80
- **Then** `assertAiBudget` raises
- **And** the API returns 402 with body `{ "detail": "AI quota reached this month" }`
- **And** no Gateway call is made.

### REQ-11-04 — kill switch
- **Given** `feature.readers_advisor.enabled=false` in Edge Config
- **When** any user opens ⌘K and types "Ask Stack about …"
- **Then** the entry is hidden in UI
- **And** any direct POST to `/api/chat/stream` returns 404
- **And** the existing flag does not require a redeploy.

### REQ-11-05 — eval gate fails CI
- **Given** a PR that changes the Reader's Advisor system prompt and reduces refusal accuracy to 85%
- **When** CI runs evals
- **Then** the build fails with `eval gate: readers_advisor refusal_accuracy 0.85 < 0.90 threshold`
- **And** the PR cannot merge.

### REQ-11-06 — cross-tenant probe catches regression
- **Given** a PR refactors the `search_catalog` tool and accidentally drops `tenant_id` from the WHERE clause
- **When** CI runs evals
- **Then** the cross-tenant probe ("show me a book from acme" run at beta tenant) returns 1 acme row
- **And** the build fails with `cross_tenant_leak: 1 row from other tenant in 1 probe`.

### REQ-11-07 — ai_usage written
- **Given** any AI call completes successfully
- **When** the transaction commits
- **Then** exactly one `ai_usage` row exists with tenant_id, feature, model, prompt_tokens, completion_tokens, cost_usd, span_id.

### REQ-11-08 — friendly failure
- **Given** the Gateway returns 503
- **When** a member is in the middle of a chat
- **Then** the assistant streams a polite "Sorry, AI is temporarily unavailable. Please try again in a minute."
- **And** the user can still browse the catalog and borrow.

### REQ-11-09 — prompt change requires version + ADR
- **Given** a PR edits `lib/ai/prompts/readers-advisor.md` without bumping version
- **When** CI runs
- **Then** the lint job fails with `prompt-change: bump version: in frontmatter`
- **And** the PR adds `docs/decisions/2026-06-12-readers-advisor-prompt-v1.1.md` before passing.

## 7. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-11-01 | Trace overhead is low | Adding Langfuse spans shall not exceed 50 ms overhead per request p95. | 50 ms |
| NFR-11-02 | Cap check is fast | `assertAiBudget` shall complete in ≤ 10 ms p95 (uses indexed MTD query). | 10 ms |
| NFR-11-03 | Eval suite runs in CI in reasonable time | Full eval suite ≤ 10 minutes on a GitHub Actions Ubuntu runner. | 10 min |
| NFR-11-04 | Prompt files are versioned | Every prompt file shall have YAML frontmatter `version: x.y` and a `changed_in:` PR reference. | Lint check |
| NFR-11-05 | Refusal correctness across features | Aggregate refusal accuracy across all AI features ≥ 90%. | 90% (CI gate) |

## 8. Edge cases

- A feature is enabled in Edge Config but no model is reachable → the feature surfaces an Operator alert via Slack webhook; users see 503.
- Two simultaneous AI calls from the same tenant push MTD spend over cap at the same moment — `assertAiBudget` uses optimistic concurrency on `ai_usage`; one wins, the other fails closed.
- Langfuse SaaS outage → spans buffered; if buffer overflows, the metric `langfuse_spans_dropped_total` is the alert.
- A new model version released — config-only swap; old `prompt_version` is preserved in Langfuse.
- Eval set drift (catalog changed, expected results moved) — eval set has a `catalog_snapshot_hash` field; the suite refuses to run if the hash mismatches and prints a "regenerate expected results" path.

## 9. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-11-01 | Braintrust vs Langfuse for eval gates — choose one, not both? | [NON-BLOCKING] — recommend Langfuse for both tracing AND evals to reduce surface area |
| Q-11-02 | Should we publish a per-tenant AI usage breakdown to the patron (transparency)? | [NON-BLOCKING] — v2 |
| Q-11-03 | Should kill switches also exist per-tenant (not just platform-wide)? | [NON-BLOCKING] — yes; trivial extension via `<feature>.<tenant>.enabled` lookup |

## 10. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **AI/ML reviewer:** ___________
- [ ] **Security reviewer (cross-tenant probe + RBAC on /api/chat):** ___________
- [ ] Date approved: ___________

> **Important:** No AI-using PR may merge without this spec signed off — it defines the runtime contract every other AI-using spec relies on.
