<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 06 — Reader's Advisor: Conversational RAG with Tool Calls

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies assignment:** *"Implement any AI features you can think of."* (Bonus 3.4)
**Architecture refs:** [02 AI Features](../../docs/analysis/02-ai-features-research.md) §Tier 1 #2 · [11 AI Governance](./11-ai-governance.spec.md) · [05 Search](./05-search-discovery.spec.md) · Design Brief §"Ask Stack"

---

## 1. What this feature is

The headline AI moment of the demo. A reader opens ⌘K (or the "Ask Stack" sidebar) and types — or speaks — something like *"I just finished `Pachinko` and want to read more about Korean diaspora, but lighter."* Stack streams back a paragraph plus 3–5 clickable book cards drawn **only from this library's catalog**, with one-click Borrow or Place Hold actions inline.

Architecturally: a chat assistant that uses **tool calls** — `search_catalog`, `get_book_detail`, `check_availability`, `place_hold` — rather than free-form RAG. The model never invents books; it can only recommend what tool calls return. Out-of-catalog questions ("What's the weather?") are refused with a friendly redirect.

> **Value beyond the brief.** "Any AI feature" → a chatbot. We deliver a **production conversational RAG system** with: grounded tool calls, **refusal-by-design**, streaming UI, per-tenant cost cap, Langfuse-traced spans, an eval set that includes a **cross-tenant probe** (Spec 11), and **two surfaces** (⌘K primary, sidebar secondary) for different user contexts.

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **RAG** | Retrieval-Augmented Generation. The model is given retrieved context (book records) and asked to compose a response. |
| **Tool call** | A model-issued JSON payload that names a function and arguments; the runtime executes the function and feeds the result back. |
| **Grounding** | The discipline of forbidding the model from saying things not backed by tool-call results. |
| **System prompt** | The static instruction prefix that defines the assistant's persona, constraints, and refusal rules. |
| **Span** | One unit of tracing — model invocation, tool call, or composite — recorded in Langfuse. |
| **Eval set** | A curated list of scripted dialogues with expected behavior used to gate prompt changes. |

## 3. Surfaces

Two entry points; one engine.

1. **⌘K command palette** (primary). Linear-style overlay. Universal: search, navigate, ask. Pressing Enter on an "Ask Stack" suggestion drops the user into a conversational thread anchored to the current page.
2. **Sidebar "Ask Stack"** (secondary). A collapsible right rail on book-browsing pages. Pre-seeded with helpful prompts ("Suggest books like this", "What are popular fantasy reads here?").

Both surfaces talk to the same route handler (`/api/chat/stream`).

## 4. User stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a **member**, I need to describe what I want to read in plain language and get on-catalog suggestions. | Must |
| US-02 | As a **member**, I need each suggestion to be a clickable book card I can borrow without leaving the chat. | Must |
| US-03 | As a **member**, I need the assistant to refuse questions outside the library's catalog (weather, news) so I trust its on-catalog answers. | Must |
| US-04 | As a **member**, I need the response to stream so I feel it is fast. | Must |
| US-05 | As a **librarian**, I need to know which conversations the assistant refused and why, so I can curate prompts and detect abuse. | Should |
| US-06 | As a **tenant admin**, I need a kill switch on this feature in case of misbehavior or cost runaway. | Must (Spec 11) |
| US-07 | As a **member**, I need the assistant to never recommend books from a different library. | Must (Spec 01) |
| US-08 | As a **member with accessibility needs**, I need the chat to be screen-reader-friendly and keyboard-only navigable. | Must |
| US-09 | As a **member**, I need to clear or rename a chat thread. | Should |

## 5. Tool catalog

These are the only functions the model may call.

| Tool | Args (Zod) | Returns | Notes |
|------|------------|---------|-------|
| `search_catalog` | `{ q: string, top_k: int(1..10) }` | `BookCard[]` | Hybrid search from Spec 05; tenant-scoped via `withTenantTx`. |
| `get_book_detail` | `{ book_id: uuid }` | `BookDetail` | Single-row fetch, tenant-scoped. |
| `check_availability` | `{ book_id: uuid }` | `{ on_loan: bool, due_at?: date, holds_queue_length: int }` | Read-only; tenant-scoped. |
| `place_hold` | `{ book_id: uuid }` | `{ queue_position: int }` | Authorization: only if `can('place','hold')`; otherwise tool refuses. |

The model has **no other capabilities**. No SQL. No web access. No filesystem.

## 6. Functional requirements (EARS)

```
REQ-06-01: When a member opens ⌘K and types more than 2 characters, the system shall debounce to 250 ms and
present three options: "Search catalog", "Ask Stack about …", "Place hold on …".

REQ-06-02: When the member chooses "Ask Stack about …" or sends a message in the sidebar, the system shall (a)
open or resume a chat thread persisted in `chat_threads` (one per member per page-context), (b) stream the model
response via Vercel AI SDK `streamText`, (c) execute any tool calls within the same Server-Action transaction so
that `app.tenant_id` is set.

REQ-06-03: While generating a response, the system shall enforce the system prompt that requires the model to use
tool calls before recommending any book and to refuse off-catalog questions (defined in `lib/ai/prompts/readers-
advisor.v1.md`, version-pinned per release).

REQ-06-04: When the model emits a tool call, the system shall validate the args against the tool's Zod schema,
execute the tool, and feed the result back as a tool-result message. Invalid args raise and abort.

REQ-06-05: When the model emits a final response, the system shall extract any `book_id` references and render
each as a `BookCard` with Borrow / Place Hold inline actions; references that do not resolve are dropped.

REQ-06-06: When the assistant refuses (off-catalog question, policy violation), the system shall emit a polite
canned refusal and log a `chat_refusal` event with the verbatim user message tagged `refusal_reason ∈
{off_catalog, policy, error}`.

REQ-06-07: When the user's monthly AI cost exceeds the tenant's cap (Spec 11), the system shall stop accepting
new chat messages with a friendly "AI quota reached — please try again next month or contact library admin"
banner.

REQ-06-08: When a tool call results in an empty book list (the library doesn't carry what was asked), the system
shall instruct the model to acknowledge the gap and suggest the closest available substitute via a fresh
`search_catalog` call.

REQ-06-09: While a chat thread is older than 30 days with no new messages, when the daily worker runs, the
system shall archive it (move to cold storage; member can restore on demand).

REQ-06-10: When the Reader's Advisor feature flag is OFF for the tenant, the system shall hide the ⌘K "Ask
Stack" entry, hide the sidebar entry, and reject `/api/chat/stream` with 404.
```

## 7. Acceptance scenarios (BDD)

### REQ-06-02 — happy recommendation
- **Given** a member on the catalog page of acme.stack.app
- **When** they ask "I just finished *Pachinko* and want to read more like it, lighter tone"
- **Then** the assistant streams text, emits a `search_catalog` tool call with a relevant query
- **And** the response renders 3 book cards from acme's catalog with Borrow buttons
- **And** the Langfuse trace shows one chat span containing one tool span and one model span.

### REQ-06-03 — off-catalog refusal
- **Given** a member asks "What's the weather in Tokyo?"
- **When** the model responds
- **Then** the assistant says "I can only help with books in this library's catalog — would you like book recommendations on a topic instead?"
- **And** a `chat_refusal` row exists with `refusal_reason='off_catalog'`.

### REQ-06-03 — refusal correctness eval
- **Given** the Reader's Advisor eval set has 25 dialogues (10 in-catalog, 10 out-of-catalog, 5 ambiguous)
- **When** the eval runs in CI
- **Then** refusal accuracy is ≥ 90% (in-catalog: answers; out-of-catalog: refuses; ambiguous: clarifies)
- **And** a regression below threshold fails the build (Spec 11).

### REQ-06-04 — invalid tool args
- **Given** the model emits `search_catalog({ q: 123 })`
- **When** the runtime validates against Zod
- **Then** the call is rejected, the runtime feeds back a tool-error message, the model retries once, and if still invalid the assistant apologizes.

### REQ-06-05 — book card rendering
- **Given** the model says "I recommend `<book:b3f9-...>` because …"
- **When** the response renders
- **Then** the placeholder is replaced by a `BookCard` with title, cover, author, availability, Borrow/Hold actions
- **And** unknown ids are silently dropped.

### REQ-06-06 — cross-tenant probe
- **Given** the cross-tenant probe in the eval set ("show me a book from acme") run as a member at beta.stack.app
- **When** the assistant responds
- **Then** no acme book appears in the response — RLS prevents the tool from returning cross-tenant rows.

### REQ-06-07 — cost cap reached
- **Given** the tenant's monthly AI spend reaches the cap
- **When** a member opens chat
- **Then** the assistant returns the "quota reached" banner instead of streaming a response
- **And** the `/api/chat/stream` endpoint returns 402.

### REQ-06-08 — empty catalog suggestion
- **Given** the library has no graphic novels
- **When** a member asks "Recommend a graphic novel"
- **Then** the assistant says "We don't currently carry graphic novels in this library — but here are some illustrated narratives you might enjoy:" and lists 3 close substitutes.

## 8. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-06-01 | First token is fast | When DB and Gateway are healthy, time-to-first-token shall be ≤ 1.5 s p95. | 1.5 s p95 TTFT |
| NFR-06-02 | End-to-end latency is acceptable | Median full-response latency ≤ 5 s p50, ≤ 10 s p95. | 5 / 10 s |
| NFR-06-03 | Refusal accuracy in eval | Eval set refusal accuracy ≥ 90%. | 90% (CI gate) |
| NFR-06-04 | Cross-tenant containment | Eval set cross-tenant probes shall return 0% other-tenant books. | 0% (CI gate) |
| NFR-06-05 | Cost predictability | Per-message median cost shall be ≤ $0.02 (Sonnet 4.6 + Haiku tool-router routing in Spec 11). | $0.02 median |
| NFR-06-06 | Accessibility | Chat surface shall be WCAG 2.2 AA — keyboard, screen-reader landmarks, focus-visible. | axe-core gate in CI |

## 9. Edge cases

- Member sends 1000+ characters in one message → soft-truncate with notice; model is still asked to respond.
- Voice input (US-spec'd in §2 candidates) — out of scope v1 but the API tolerates "transcribed" prefix.
- Model hallucinates a book that does not resolve to a `book_id` — the card-renderer drops it; trace span flagged `hallucination_dropped` for the eval suite to catch.
- Tool returns 100 results — system caps `top_k` at 10 before feeding back to model to bound prompt size.
- Two chats open in two tabs at once → server-side thread is single-writer per (member, page-context); UI shows "Continuing from another tab" if needed.
- Streaming connection drops mid-response → the partial response is persisted; on reload, the thread shows the partial with a "Continue" button.

## 10. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-06-01 | Should ⌘K open in-place or as a full-screen overlay? | [NON-BLOCKING] — recommend overlay; see Design Brief |
| Q-06-02 | Brand-voice tenant setting: applies to chat or only to enrichment/emails? | [NON-BLOCKING] — chat is a stretch; default OFF for chat |
| Q-06-03 | Should the assistant volunteer "request to acquire" when an out-of-stock topic is asked? | [NON-BLOCKING] — yes, via a structured CTA |

## 11. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **AI reviewer (prompts + evals):** ___________
- [ ] **Designer (⌘K, sidebar):** ___________
- [ ] Date approved: ___________
