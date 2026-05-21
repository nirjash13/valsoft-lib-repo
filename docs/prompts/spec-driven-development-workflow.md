<!-- written-by: writer-haiku | model: haiku -->

# Spec-Driven Development Workflow Guide

## Introduction

Unstructured AI coding amplifies output volume at the cost of quality, consistency, and alignment with requirements. This guide establishes a 4-stage human-AI collaboration workflow that puts humans back in control of requirements and design, then leverages AI as a *force multiplier* for specification and implementation.

The workflow ensures that by the time a coding agent writes the first line of code, the team has already agreed on *what* to build, *why* it matters, and *how* success is measured. Teams adopting structured spec-driven development report 30–40% faster time-to-market and a 41% reduction in defect escape rates.

---

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STAGE 1: REQUIREMENTS GATHERING                               │
│  (Human-led, AI-assisted)                                       │
│  ├─ Gather requirements from stakeholders                       │
│  ├─ Restate problem in team's own words                         │
│  ├─ AI assists with articulation, not design                    │
│  └─ Output: Problem statement + confirmed requirements          │
│                                                                 │
│  ⬇️                                                              │
│                                                                 │
│  STAGE 2: HUMAN DESIGN                                          │
│  (Human-only — zero AI)                                         │
│  ├─ Sketch wireframes, flows, data models                       │
│  ├─ Break problem into parts (if complex)                       │
│  ├─ Document architectural intent                               │
│  └─ Output: Design sketches + design notes                      │
│                                                                 │
│  ⬇️                                                              │
│                                                                 │
│  STAGE 3: SPEC GENERATION                                       │
│  (AI-amplified, human-refined)                                  │
│  ├─ Engineer provides: requirements + design + codebase ref     │
│  ├─ AI generates functional/non-functional reqs (EARS format)   │
│  ├─ AI produces acceptance criteria (BDD/Given-When-Then)       │
│  ├─ AI validates human design, suggests alternatives w/ rationale
│  ├─ Collaborative refinement loop: feedback → revise → approve  │
│  └─ Output: .spec.md file(s) ready for implementation           │
│                                                                 │
│  ⬇️                                                              │
│                                                                 │
│  STAGE 4: IMPLEMENTATION WITH QUALITY GATES                     │
│  (AI-assisted, human-verified)                                  │
│  ├─ Engineers + coding agents implement against spec            │
│  ├─ Acceptance criteria must pass before merge                  │
│  ├─ Quality gates: tests → code review → human review           │
│  └─ Output: Production code + verified ClickUp task closed      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Stage 1: Requirements Gathering

**Who:** Product Owner + engineers + stakeholders  
**Goal:** Understand the *problem*, not the solution  
**Duration:** 1–2 hours  
**Output:** Problem statement, raw requirements list, Product Owner sign-off

### Steps

1. **Gather Raw Requirements**
   - Conduct interviews or review stakeholder requests
   - Document what's asked for, not how to do it
   - Collect constraints (performance targets, security, compliance, budget)
   - Note any existing workarounds or pain points

2. **Restate the Problem in Your Own Words**
   - Write a 2–3 sentence problem statement
   - Example: *"Customers cannot audit which team members accessed their compliance documents. This creates liability risk and makes it hard to debug permission issues during investigations."*
   - This forces clarity — vague language collapses here

3. **List Requirements as User Needs**
   - Use the format: *"As a [role], I need [capability] so that [business value]"*
   - Do not propose solutions yet
   - Example:
     - As a compliance officer, I need a timestamp log of all document access so that I can audit who touched sensitive data
     - As a support engineer, I need to filter the log by date range so that I can troubleshoot permission issues quickly
     - As a security officer, I need to export audit logs so that I can send them to SOC 2 auditors

4. **Surface Ambiguities (AI Can Help Here)**
   - Ask clarifying questions: *"Does 'access' mean 'view', 'download', or both?"*
   - AI can suggest missing questions based on the codebase patterns
   - Do not resolve these yourself — escalate to stakeholders

5. **Link to ClickUp**
   - Attach the problem statement and requirements list to the ClickUp task
   - Tag @Product Owner for explicit confirmation before Stage 2
   - If PO does not explicitly confirm, revisit the requirements

### Example

**Problem Statement:**  
*Billing team cannot reconcile failed payment transactions. When a customer's card is declined, we log the error but provide no timeline or failure reason to support staff. This causes delayed refunds and angry customers.*

**Requirements (PO-confirmed):**
- Log every payment transaction with timestamp, customer ID, amount, and result (success/failure)
- If failed, capture the decline reason (insufficient funds, invalid card, etc.)
- Provide support staff a searchable transaction history UI
- Ensure logs cannot be edited or deleted (audit trail requirement)

---

## Stage 2: Human Design

**Who:** Tech lead + engineers (no Product Manager needed)  
**Goal:** Establish architectural intent *before* AI sees it  
**Duration:** 1–3 hours depending on complexity  
**Output:** Design sketches, flow diagrams, data model notes

> **Note:** This stage is deliberately human-only. If you ask an AI to help with design, you lose ownership of the architecture. The goal is for humans to have made a deliberate choice about how to solve the problem, which AI then validates and refines in Stage 3.

### Steps

1. **Sketch the Data Model**
   - Draw entities and relationships (use a whiteboard, Lucidchart, or pencil)
   - Identify the core entities and how they relate
   - Example for billing: `Transaction` → `PaymentMethod`, `DeclineReason`, `Customer`
   - Do not implement — just understand what data exists

2. **Draw the Flow**
   - Sketch the happy path: what happens when a payment succeeds
   - Sketch the unhappy path: what happens when it fails, who needs to know, when do they need to know
   - Example: Customer initiates payment → stripe/processor → callback with result → log transaction → notify support if failed → expose in UI

3. **Identify Integration Points**
   - What systems does this touch? (payment processor, database, notification system, support UI)
   - How do they communicate? (REST API, webhooks, message queue, scheduled job)
   - Any async or polling logic needed?

4. **Sketch the UI (If Applicable)**
   - Low-fidelity wireframe: what information is shown, how is it organized
   - Who sees what? (support staff vs. compliance vs. admin)
   - What interactions are needed? (search, filter, export, drill-down)

5. **Document Design Decisions**
   - Why did you choose this shape? (e.g., *"We use webhooks instead of polling because payment processors call us immediately and we need near-real-time logs."*)
   - What alternatives did you consider and reject? (keep for Stage 3 reference)
   - Any constraints this design must respect? (e.g., *"We cannot change the payment processor integration without affecting 10 customers."*)

### Example Design Notes

```
Data Model:
- Transaction (id, customer_id, amount, status, created_at, updated_at)
- DeclineReason (code, description, category: [insufficient_funds, invalid_card, ...])
- Relationship: Transaction has_one DeclineReason (if status = failed)

Flow:
1. Customer submits payment form → calls POST /api/billing/transactions
2. Service calls stripe.charge()
3. Stripe returns immediately with result
4. We insert Transaction row with status = pending, then call stripe webhook to get final status
5. Stripe POSTs to /webhooks/stripe with charge event
6. We update Transaction.status and DeclineReason.id if failed
7. If status = failed, emit event to support notification channel

UI (Support Dashboard):
- List of transactions (paginated, default 50)
- Filter by: date range, customer, status (success/failed), decline reason
- Columns: timestamp, customer name, amount, status, decline reason (if failed)
- Export as CSV button (for auditors)

Design rationale:
- Webhook instead of polling: Stripe tells us immediately, no lag
- Immutable logs: use soft-delete if needed, audit trail never overwritten
```

---

## Stage 3: Spec Generation

**Who:** Engineer + AI coding agent (Claude Code `architect` agent or equivalent)  
**Goal:** Turn requirements + design into a machine-readable, testable spec  
**Duration:** 2–4 hours (including collaborative refinement)  
**Output:** One or more `.spec.md` files approved by tech lead and Product Owner

> **Note:** This is the most critical stage. A thorough spec prevents misalignment during implementation. Invest time here to save days of rework later.

### Step-by-Step Process

#### Step 1: Prepare the Context Package

Gather and provide to AI:
- **Confirmed requirements** from Stage 1 (copy the PO-signed requirements)
- **Design sketches/notes** from Stage 2 (paste or reference them)
- **Codebase reference** — link to analogous features in the codebase or point AI to the architecture documentation
- **Example:** *"We have an existing Payment service at `app/services/payment.py`. Here's how it currently works: [paste 50 lines]. We also have a WebhookHandler pattern at `app/api/webhooks/` that you should follow."*

#### Step 2: Prompt AI for Clarification

Before AI writes the spec, have it ask clarifying questions. Example:

> *Here's what I understand: [repeat back requirements + design]. Before I generate the spec, I have these clarifying questions:*
> - *Should the DeclineReason be extensible (new codes added without code deploy)?*
> - *Is the audit log queryable in real-time or is once-per-day export acceptable?*
> - *Should we retry failed payments automatically or wait for manual intervention?*

**Do not skip this.** Answer the questions, and AI will generate a better, more specific spec.

#### Step 3: AI Generates Functional Requirements (EARS Format)

EARS (Easy Approach to Requirements Syntax) is structured and testable. Format:

```
While [precondition],
when [trigger event],
the [system] shall [action].
```

Example:

```
REQ-001: Log Successful Transactions
While a Customer has submitted a valid payment form,
when the payment processor returns a success response,
the system shall create a Transaction row with status=success within 500ms.

REQ-002: Capture Decline Reasons
While a Customer has submitted a valid payment form,
when the payment processor returns a decline response,
the system shall create a Transaction row with status=failed and populate DeclineReason.code from the processor response within 1s.

REQ-003: Immutable Audit Trail
While a Transaction has been created,
when a support engineer attempts to modify or delete the Transaction,
the system shall reject the request with HTTP 405 (Method Not Allowed).

REQ-004: Searchable Transaction History
While a support engineer is on the Transactions page,
when they enter a customer name in the search field,
the system shall return all matching Transactions within 2s and display no more than 50 results.
```

#### Step 4: AI Generates Non-Functional Requirements

Explicitly call out performance, security, scalability, and reliability:

```
NFR-001: Latency
Payment processing logs must be written within 500ms of processor callback.

NFR-002: Availability
Transaction API must be available 99.95% of the time (max 21.6 minutes downtime/month).

NFR-003: Security
Transaction data must be encrypted at rest. Decline reasons must not leak PII (no customer bank account numbers). Only authenticated support staff can view transactions.

NFR-004: Audit Trail Immutability
Transactions and DeclineReasons must not be modifiable or deletable once created. All accesses must be logged.

NFR-005: Scalability
System must handle 10,000 transactions/minute peak load without degradation.
```

#### Step 5: AI Generates Acceptance Criteria (BDD Format)

Use Given-When-Then. Each requirement should have 2–3 acceptance criteria:

```
REQ-001 Acceptance Criteria:

Scenario 1: Successful payment is logged
Given a Customer with a valid payment method
When the Customer submits a payment form for $50
Then a Transaction row is created with (customer_id, amount=50, status=success) within 500ms
And the Transaction.created_at timestamp matches the payment processor response time ±1s

Scenario 2: Successful payment appears in support UI
Given a Transaction with status=success was created 2 minutes ago
When a support engineer navigates to /support/transactions
Then the Transaction is visible in the list within 2s
And the row displays: customer name, $50, success, timestamp

REQ-002 Acceptance Criteria:

Scenario 1: Failed payment captures decline reason
Given a Customer with a card declined for insufficient funds
When the Customer submits a payment form for $100
Then a Transaction row is created with status=failed within 1s
And DeclineReason.code = "insufficient_funds"

Scenario 2: Support engineer sees decline reason in UI
Given a Transaction with status=failed and DeclineReason.code = "insufficient_funds"
When a support engineer navigates to that Transaction's detail page
Then the page displays: "Declined: Insufficient funds"
And the timestamp of the decline is shown

REQ-003 Acceptance Criteria:

Scenario 1: Support engineer cannot edit a transaction
Given a Transaction with status=success created 1 day ago
When a support engineer attempts PUT /api/transactions/[id] with new_status=failed
Then the API returns HTTP 405 (Method Not Allowed)
And the Transaction remains unchanged

Scenario 2: Support engineer cannot delete a transaction
Given a Transaction with status=failed created 1 hour ago
When a support engineer attempts DELETE /api/transactions/[id]
Then the API returns HTTP 405 (Method Not Allowed)
And the Transaction remains in the database
```

#### Step 6: AI Validates the Human Design

AI should explicitly review the design from Stage 2:

```
Design Validation:

✓ Webhook approach is sound — Stripe callbacks are reliable and our codebase 
  already has WebhookHandler in place. No change needed.

⚠ Question: Your design uses a single Transaction table. As volume grows 
  (10K tx/min = 864M rows/year), queries will slow without indexing. 
  Recommendation: Add indices on (customer_id, created_at) and (status, created_at) 
  from day one. See draft migration below.

✓ Immutable log design prevents audit trail tampering — aligns with security 
  requirements.

△ Alternative to consider: Instead of storing DeclineReason as a foreign key, 
  embed it as a JSON object {code, description} in Transaction. Pros: one table, 
  simpler queries. Cons: harder to change decline reason mappings later. 
  Recommendation: Keep your design (separate table) — it's more flexible.
```

#### Step 7: Collaborative Refinement Loop

The engineer reviews the AI-generated spec and provides feedback:

**Engineer:** *"REQ-004 says support engineers must search by customer name, but we don't have a Customer table linked to the processor. How do we know customer name?"*

**AI:** *"Good catch. Let me revise: we'll need a lookup to your User table. Assumption: every Transaction has a customer_id that maps to User.id. Does that match your schema?"*

**Engineer:** *"Yes, but not every user has made a transaction. And we have some legacy records where customer_id is NULL. How should we handle those?"*

**AI:** *"Revised REQ-004: search matches User.name where Transaction.customer_id = User.id. Transactions with NULL customer_id are excluded from name search. They can still be found by date range or transaction ID. Is that acceptable?"*

**Engineer:** *"Yes. But we also have some transactions from before we linked to User. Can we handle that differently?"*

**AI:** *"I'll add a new field to Transaction: customer_name_cache (denormalized, set at transaction time). That way legacy records are searchable by name without a foreign key. Trade-off: we store name twice, but search is simple. OK?"*

**Engineer:** *"Perfect. Also, REQ-003 says transactions are immutable, but audit sometimes needs to mark a transaction as fraudulent for internal notes. Can we have a readonly audit_notes field?"*

**AI:** *"Great point. I'll revise REQ-003 to allow append-only audit_notes (support can add notes, but never edit or delete them). I'll also update the acceptance criteria."*

Repeat until the spec is rock-solid.

#### Step 8: Output Checklist

Before approving, verify the spec has:

- [ ] Problem statement and confirmed requirements from PO
- [ ] Reference to Stage 2 design (sketches or notes)
- [ ] At least one EARS requirement per user story
- [ ] Non-functional requirements (latency, security, availability)
- [ ] 2–3 BDD acceptance criteria per requirement
- [ ] Edge cases explicitly called out (null customer, retry logic, etc.)
- [ ] AI design validation (confirms, flags, or suggests alternatives)
- [ ] Tech lead sign-off
- [ ] Product Owner sign-off

---

## Stage 4: Implementation with Quality Gates

**Who:** Engineers + Claude Code (or GitHub Copilot) + code review team  
**Goal:** Implement the spec without scope creep or deviation  
**Duration:** Variable (depends on spec complexity)  
**Output:** Code merged, tests passing, ClickUp task closed

### Steps

1. **Link the Spec in ClickUp**
   - Attach the `.spec.md` file to the ClickUp task
   - Add acceptance criteria checkboxes in the task description (copy from spec)
   - Set ClickUp task status to "In Progress"

2. **Implement Against the Spec**
   - Use Claude Code with the spec as context: `@docs/development-process/[feature-name].spec.md`
   - For each acceptance criterion, write a test first (test-driven development)
   - Implement code to pass the test
   - If the spec is ambiguous during implementation, do not guess — escalate to tech lead

3. **Automated Tests (Required)**
   - Unit tests for service logic (Transaction creation, DeclineReason lookup, etc.)
   - Integration tests for API endpoints (POST, GET, search, auth checks)
   - All acceptance criteria must have a corresponding test
   - All tests must pass before opening a PR

4. **Code Review Gate 1: AI Code Review**
   - Use Claude Code's `critic` agent or GitHub Copilot's code review feature
   - Checklist:
     - [ ] Code follows codebase patterns (e.g., repository pattern, async/await style)
     - [ ] Type hints are complete (no `Any` without justification)
     - [ ] Error handling is explicit (no silent failures)
     - [ ] No SQL injection, no unvalidated input, no secrets in code
     - [ ] Architecture decisions match the spec design validation section
     - [ ] Acceptance criteria are provably met by tests

5. **Code Review Gate 2: Human PR Review**
   - Tech lead reviews the PR against the spec
   - Checklist:
     - [ ] Every acceptance criterion has a test that passes
     - [ ] No scope creep (only what's in the spec)
     - [ ] No breaking changes to existing APIs
     - [ ] Database migration (if needed) is idempotent and safe
     - [ ] Performance: does latency meet NFR-001? Does scalability approach NFR-005?
     - [ ] Security: no new vulnerabilities introduced (use OWASP checklist if available)

6. **Acceptance Criteria Sign-Off**
   - Before merge, check every acceptance criterion in the spec:
     - [ ] REQ-001 Scenario 1: Test passes ✓
     - [ ] REQ-001 Scenario 2: Test passes ✓
     - [ ] REQ-002 Scenario 1: Test passes ✓
     - [ ] ... (continue for every criterion)
   - If any criterion is missing a test or the test fails, do not merge

7. **Merge and Close**
   - Merge the PR to main
   - Update ClickUp task: check off acceptance criteria, set status to "Done"
   - Link PR in ClickUp for traceability

### Implementation Tips

**When Using Claude Code Against a Spec:**
```
@docs/development-process/billing-audit.spec.md

/implement

Create the Transaction model, repository, and API endpoints according to the spec. 
Ensure every acceptance criterion has a corresponding test. Use the codebase patterns 
from app/repositories/ and app/services/ as reference.
```

**Tag AI-Generated PRs:**
- If Claude Code generated >80% of the code, add label `ai-generated-pr` and `focus-review:architecture`
- This signals to human reviewers to pay special attention to architectural alignment
- Reviewers should ask: *"Does this match the spec design validation? Are there any unstated assumptions?"*

---

## Spec File Template

Copy this template and save as `docs/development-process/[feature-name].spec.md`:

```markdown
<!-- written-by: writer-haiku | model: haiku -->

# [Feature Name] Specification

## Problem Statement
[1–2 sentences describing the business problem being solved]

## Confirmed Requirements (from Stage 1)
- Requirement 1
- Requirement 2
- [...]

## Design Overview (from Stage 2)
[Reference to design sketches, flow diagrams, data model]

[Paste design notes or link to Lucidchart diagram]

## Functional Requirements (EARS Format)

### REQ-001: [Title]
While [precondition],
when [trigger],
the system shall [action].

### REQ-002: [Title]
[...]

## Non-Functional Requirements

### NFR-001: Performance
[...]

### NFR-002: Security
[...]

### NFR-003: Availability
[...]

## Acceptance Criteria (BDD Format)

### REQ-001 Acceptance Criteria

**Scenario 1: [Title]**
- Given: [precondition]
- When: [action]
- Then: [expected result]

**Scenario 2: [Title]**
- Given: [...]
- When: [...]
- Then: [...]

### REQ-002 Acceptance Criteria
[...]

## Design Validation

[AI analysis of the Stage 2 design:]

✓ [What is confirmed]
⚠ [What needs refinement]
△ [Alternative approaches and rationale]

## Edge Cases

- [Case 1]
- [Case 2]
- [...]

## Database Schema (Draft)

[Pseudocode or DDL for any new tables/columns]

## API Contract (Draft)

[Example requests/responses for new endpoints]

---

**Approved by:**
- Tech Lead: [Name] ✓
- Product Owner: [Name] ✓
- Date: [YYYY-MM-DD]
```

---

## Quick Reference Card

| Stage | Who | Input | Output | Tools |
|-------|-----|-------|--------|-------|
| **1. Requirements** | PO + Engineers | Stakeholder requests | Problem statement + requirements list (PO-signed) | ClickUp, Slack, meet in person |
| **2. Design** | Tech lead + Engineers | Requirements | Sketches + flow diagrams + design notes | Lucidchart, whiteboard, Google Docs |
| **3. Spec** | Engineers + AI | Requirements + design + codebase | `.spec.md` file (EARS + BDD) | Claude Code `/architect` or GitHub Copilot |
| **4. Implementation** | Engineers + AI | Spec file | Code + tests + PR | Claude Code `/implement`, GitHub, pytest |

---

## Common Mistakes to Avoid

### Mistake 1: Skipping Requirements Confirmation
**What happens:** Engineer assumes they understand the requirement, implements alone, ships the wrong thing.  
**Fix:** Require Product Owner sign-off in Stage 1 before proceeding. If you're unsure, it's not confirmed.

### Mistake 2: AI Designs in Stage 3
**What happens:** Engineer asks AI *"How should we build this?"* before the team has thought about it. AI proposes a solution. Engineer implements the AI solution. Team never agrees on the design.  
**Fix:** Humans design in Stage 2 (no AI). AI refines and validates in Stage 3 (after humans have decided).

### Mistake 3: Vague Acceptance Criteria
**What happens:** Spec says *"The API should be fast"* instead of *"latency < 500ms"*. Engineer ships code that meets the spec but fails in production because "fast" was subjective.  
**Fix:** Use BDD format (Given/When/Then) and include measurable thresholds (latency, timeout, retry count, etc.).

### Mistake 4: No AI Code Review
**What happens:** Engineer uses Claude Code to generate code, human reviewer only checks style, architecture bugs slip through (e.g., N+1 query, missing auth check).  
**Fix:** Use AI code review gate (critic agent or GitHub Copilot review) before human review. AI catches implementation bugs; humans catch design misalignment.

### Mistake 5: Implementing Beyond the Spec
**What happens:** Engineer adds features not in the spec (nice-to-haves that sound good). Spec doesn't cover them, so no test, so they break later.  
**Fix:** Enforce: if it's not in the spec, it gets its own ClickUp task and its own `/feature` pipeline. Do not mix.

### Mistake 6: Skipping BDD Tests
**What happens:** Code passes unit tests but fails acceptance criteria (e.g., latency requirement not tested).  
**Fix:** Write one integration test per BDD scenario. That test must pass before merge. If a criterion has no test, the spec is incomplete — send it back to Stage 3.

---

## Getting Started

1. **Pick your first feature:** Choose a medium-sized feature (not trivial, not massive) to pilot this workflow.
2. **Stage 1:** Gather requirements, get PO sign-off, link to ClickUp.
3. **Stage 2:** Tech lead sketches the design (1 hour), documents design notes.
4. **Stage 3:** Use Claude Code `architect` agent with the template above. Spend 2 hours on refinement. Get sign-off.
5. **Stage 4:** Implement using Claude Code `/implement` against the spec. Run quality gates. Ship.
6. **Retro:** What worked? What was tedious? What was skipped? Adjust the process.

Each iteration improves. By your fifth feature, the workflow will feel natural.

---

## Questions?

- **"When do we skip stages?"** — You don't. Each stage prevents failure modes in the next. Skipping Stage 1 → vague requirements. Skipping Stage 2 → architecture misalignment. Skipping Stage 3 → inconsistent code. Skipping quality gates → bugs in production.
- **"Can we parallelize?"** — Stages 1 and 2 can run in parallel if you have separate teams. Stages 3 and 4 are sequential.
- **"Who breaks ties if PO and tech lead disagree?"** — PO owns requirements (what we build). Tech lead owns architecture (how we build it). If they disagree, escalate to a product manager or engineering lead to mediate.
- **"How often do we update the spec?"** — Once approved, the spec is frozen. If requirements change mid-implementation, create a new ClickUp task for the change (it's a new feature or a bug fix). Do not edit the approved spec — that breaks traceability.
