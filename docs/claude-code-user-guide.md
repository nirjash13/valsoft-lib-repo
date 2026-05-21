# Laura Agents — Claude Code User Guide

<!-- written-by: writer-haiku | model: haiku -->

Use Claude Code to build features, fix bugs, and review code with automatically routed specialist agents. This guide teaches you the workflow, how routing works, token discipline habits, and how non-Claude-Code users can mimic the same pipeline.

---

## 1. Quick Start

### 1.1 Five Commands You'll Actually Use

These five pipeline commands orchestrate multi-step workflows without manual agent selection:

- **`/feature <description>`** — Full pipeline: analyze → approve → implement → review → simplify → document. Use when building a new feature or significant enhancement.
- **`/fix <bug description>`** — Bug pipeline: diagnose → fix → review → document. Use when you have a bug report or error message.
- **`/analyze <problem>`** — Deep architecture analysis using RADAR-enhanced methodology. Use for tradeoff decisions, design reviews, or root-cause analysis.
- **`/implement <plan>`** — Smart implementation with automatic parallelization and review. Use when you have a plan and want to code it up.
- **`/review [files]`** — Security + correctness review with automated tooling (lint, type check, tests). Use before opening a PR or after significant changes.

### 1.2 The Five-Second Rule

When should you use which command?

| Situation | Command | What Happens |
|-----------|---------|--------------|
| "Build me a user notifications feature" | `/feature` | Architect designs, you approve, builders code in parallel, reviewer checks, haiku documents. Full pipeline. |
| "Users can't sign in; auth_service.py line 58 is crashing" | `/fix` | Debugger diagnoses, bug-fixer applies minimal fix, reviewer checks, history recorded. |
| "Should we cache the config service or fetch per-request?" | `/analyze` | Architect evaluates both approaches with precedent and tradeoffs. No code yet. |
| "Here's a design doc; implement it" | `/implement` | Builders take the plan and code it in parallel. Faster than `/feature` (skips analysis). |
| "I've made changes on this branch; is it safe?" | `/review` | Runs lint, type checks, tests; sends to reviewer for security/correctness audit. |

### 1.3 Your First /feature Run, Walked Through

Let's say you want to add a "compliance audit export" feature.

**Command:**
```
/feature Add a compliance audit export endpoint that generates a PDF report of all system changes in the last 90 days, includes actor, timestamp, and resource type. Accept CSV too.
```

**What you'll see:**

1. **ANALYZE phase** (architect-opus) — 2-3 minutes
   - Architect reads the feature description and project context.
   - Proposes 3 approaches (inline PDF generation, async worker, third-party service).
   - Recommends approach, suggests database queries, lists tasks.
   - Outputs: plan with task groups and parallelization strategy.

2. **APPROVE phase** — You review
   - Read the architect's plan.
   - Approve ("looks good"), request changes ("add timezone handling"), or reject ("too expensive").
   - If changes, architect refines and you re-approve.
   - **Do not skip this** — the plan is your contract.

3. **IMPLEMENT phase** (builder-sonnet, parallel) — 5-10 minutes
   - Builders spawn for each independent task group.
   - Builder 1: add database migration + schema.
   - Builder 2: add API endpoint + service layer.
   - Builder 3: add tests.
   - Each follows: write test (RED) → code (GREEN) → refactor.
   - Parallel means "wait for all builders to finish."

4. **REVIEW phase** (critic-opus, conditional) — 2-5 minutes
   - python-reviewer runs first (fast, automated linting + type check).
   - If issues, critic-opus reviews for security, correctness, architecture fit.
   - If NEEDS-FIXES, builder-sonnet patches and re-reviews.
   - Loop until APPROVED.

5. **SIMPLIFY phase** (optional) — 1-2 minutes
   - A simplify pass runs to check for dead code, redundant abstractions, overly-complex patterns.
   - If issues found, they are addressed and re-reviewed.

6. **DOCUMENT phase** (writer-haiku, conditional) — 1-2 minutes
   - If the changelog update is a single-line bullet under `unreleased`, the orchestrator writes it directly.
   - Larger entries (new dated section with summary + multiple highlights) or architecture doc updates go to writer-haiku.

**When done**, you have:
- All code committed (builders don't commit; you do after review).
- A clear summary of what changed and why.
- Confidence it passed security + correctness gates.

**Your job:** approve the plan, then commit the final code.

---

## 2. How the Routing Works

### 2.1 Why Three Models and What Each Costs

The pipeline uses three Claude models. Costs matter because output is roughly 5× more expensive than input across all Anthropic models, so output discipline matters everywhere.

| Model | Input Cost | Output Cost | Context | When Used | Typical Cost per Invocation |
|-------|-----------|-----------|---------|-----------|---------------------------|
| **Opus 4.7** | $15/M | $75/M | 1M tokens | Analysis, review, diagnosis | $0.10–$0.50 (depends on output length) |
| **Sonnet 4.6** | $3/M | $15/M | 1M tokens | Implementation, refactoring, tests | $0.05–$0.25 |
| **Haiku 4.5** | $1/M | $5/M | 200K tokens | Writing, summaries, docs | $0.01–$0.05 |

**Rule of thumb:** Opus is expensive but deep. Sonnet is fast and precise. Haiku is cheap and terse. The pipeline uses each for its sweet spot.

**Pricing note:** Costs as of late 2025; check https://anthropic.com/pricing for current rates.

### 2.2 The Agent Roster

Six specialist agents handle different tasks. Each is pinned to one model.

**architect-opus** (Opus)
- **When:** `/feature`, `/analyze`, `/implement` (plan phase)
- **What:** Analyzes requirements, proposes 3 approaches, recommends one with tradeoffs, produces spec and task plan
- **Returns:** Bulleted plan with independent task groups, spec details, risk pre-mortem
- **Cost driver:** Reads a lot, outputs analysis. ~1000–2000 tokens output typical.

**builder-sonnet** (Sonnet)
- **When:** `/feature`, `/fix`, `/implement` (code phase) — spawned 1+ times in parallel
- **What:** Writes code (TDD: test first, then implementation), refactors, adds migrations
- **Returns:** Working code, passing tests, clean diff
- **Cost driver:** Spawned once per independent task group. ~500–2000 tokens output each.

**bug-fixer-sonnet** (Sonnet)
- **When:** `/fix` (fix phase) — takes diagnosis from debugger
- **What:** Writes exactly one regression test (RED), applies minimal fix, verifies test passes
- **Returns:** Fixed code, single regression test, no side effects
- **Cost driver:** Surgical, focused. ~300–1000 tokens output typical.

**critic-opus** (Opus)
- **When:** End of `/feature`, `/fix`, `/implement` — conditional on tiered review gate
- **What:** Finds security issues, correctness bugs, architecture violations, missing tests
- **Returns:** Verdict (APPROVE / NEEDS-FIXES / BLOCKED) with specific locations and remediation
- **Cost driver:** Reads all changed files + test output. ~1500–3000 tokens output typical.

**writer-haiku** (Haiku)
- **When:** Documentation, specs, summaries, changelogs, ADRs
- **What:** Writes Markdown, transforms notes into polished docs, keeps language precise
- **Returns:** Finished documentation ready to merge
- **Cost driver:** Cheap. ~200–800 tokens output typical.

### 2.3 The Pipeline — How `/feature` Chains Agents

Here's what happens when you run `/feature`:

```
YOU
 ↓
[/feature] orchestrator
 ↓
1. ARCHITECT → plan.md (scratch file)
 ↓
2. YOU approve or request changes
 ↓
3. BUILDERS (parallel) → implement each task group
   ├─ Builder A: feature layer code
   ├─ Builder B: API endpoints
   └─ Builder C: tests
 ↓
4. PYTHON-REVIEWER → automated checks (ruff, mypy, pytest)
 ↓
5. CRITIC (if needed) → security + correctness review
   └─ If issues: BUILDER fixes → CRITIC re-reviews (loop)
 ↓
6. SIMPLIFY (optional) → unused code removal
 ↓
7. WRITER → CHANGELOG_AI.md + architecture updates
 ↓
YOU commit the final code
```

**Cost breakdown for a typical `/feature`:**
- Architect: $0.30 (1500 tokens output)
- Builders (3 parallel): $0.45 (1000 tokens each)
- Critic: $0.25 (conditional; python-reviewer might skip it)
- Writer: $0.02 (cheap)
- **Total: ~$1.00 per feature**

---

## 3. Token Discipline (Cost-Saving Habits)

The pipeline is efficient, but you can blow through tokens by repeating context or pasting large logs. These habits save 50%+ of your cost.

### 3.1 What Burns Tokens

- **Repeated agent spawns** — Calling `/feature` → `/feature` again without `/compact` re-reads all prior context.
- **Paste-bombing** — Pasting 500 lines of log directly into chat instead of referencing a file.
- **Broad file reads** — Asking builder to read a 1000-line file when only 50 lines changed.
- **No context cleanup** — After 3 subagents in one `/feature` run, context swells to 100K+ tokens.

**Pricing reminder:** Anthropic models charge roughly 5× more per output token than per input token across all tiers (Opus, Sonnet, Haiku), so output discipline saves the most tokens.

### 3.2 Use File References, Not Paste-Bombs

**Rule:** If you're pasting >150 lines or >10k characters, stop and save it to a file first.

**Bad:**
```
I got this error:
Traceback (most recent call last):
  File "app/services/auth.py", line 58, in verify_token
    header = request.headers['Authorization']
TypeError: 'NoneType' object is not subscriptable
... [100 more lines] ...
```

**Good:**
```
I got an error. I've saved the full traceback to error-log.txt.
What's the root cause?
```

Then let the agent read the file with `@error-log.txt`. Agents are trained to use `Read` tool instead of pasted content.

### 3.3 When to `/compact` and `/clear`

**Use `/compact`:**
- After 3 subagents spawn in a single `/feature` or `/implement` run.
- When current context exceeds ~50K tokens.
- `/compact` squashes prior messages into a summary, resets context size, keeps memory alive.

**Use `/clear`:**
- Between unrelated tasks (e.g., you finish a feature, then start a bug fix in a different module).
- `/clear` wipes conversation history entirely.

**Bad habit:** Running `/feature` → `/feature` → `/feature` without compacting in between. By the third run, you're re-reading the entire project context on each spawn.

**Good habit:** Run `/feature` for feature A. After it completes, run `/compact`. Then run `/feature` for feature B. Context stays fresh.

### 3.4 The Triage Tags — Nudging Architect to Be Terse

When you call `/analyze` or `/feature`, the architect starts with a **triage** that classifies the work:

- **TRIVIAL** — Single-file change, user already stated approach, no ambiguity. Architect skips deep analysis, caps output at ~300 words. (Rare.)
- **STANDARD** (default) — Multi-file or non-obvious. Architect runs full analysis but abbreviates some phases.
- **DEEP** — Security-sensitive, schema migration, cross-cutting refactor, or you explicitly asked for it. Full RADAR protocol, no cost-cutting.

You can nudge the architect by framing the request:

**Better triaged as TRIVIAL:**
```
/feature Add a new field `is_active` to the User model, with a migration.
(The architect sees: single table, no cross-cutting logic → TRIVIAL → 300-word plan)
```

**Triaged as STANDARD:**
```
/feature Implement multi-tenant support for the audit system.
(The architect sees: affects multiple services → STANDARD → full analysis)
```

**Triaged as DEEP:**
```
/analyze Should we use row-level security or application-level filtering for auth?
(You're asking for tradeoffs → DEEP → full pre-mortem, pairwise comparison)
```

### 3.5 COMPACT vs STANDARD Output Modes

Two modes control output verbosity:

| Mode | Format | When Used | Cost |
|------|--------|-----------|------|
| **COMPACT** | Telegraphic: bullets, no empty sections, verdict-first, max ~300 words | Inter-agent handoffs (builder reading architect's plan) and automated tools (python-reviewer). | Saves ~60% vs STANDARD. |
| **STANDARD** | Full prose with sections. | User-facing: final `/feature` summary, spec docs, changelogs. | Full output, more detail. |

**You don't pick the mode.** The pipeline picks it for you:
- When architect hands plan to builder, it's COMPACT (builder gets bullets, not essays).
- When you ask for `/review`, critic returns STANDARD (you need detail).
- Inside subagents, orchestrators pass `--compact` flag if it's a handoff.

**Why it matters:** If you ask architect for full analysis and they output COMPACT by mistake, you get a terse, 300-word response. If you see that, ask them to repeat in STANDARD mode:
```
Can you expand that analysis? Output in full STANDARD prose, not COMPACT bullets.
```

---

## 4. Working with Memory

The project uses a hybrid memory model: a lean always-loaded file (`active.yaml`) plus detailed archives.

### 4.1 active.yaml — What Goes In

File: `.claude/memory/active.yaml`

Keep it **under 100 lines**. Only high-signal, current info:

- **current_focus** — What you're actively working on this week/sprint
- **recent_changes** — Last 3–5 significant changes (date, summary, files touched)
- **open_blockers** — Things preventing forward progress
- **decisions_recent** — Last 3 design decisions
- **bugs_open** — Active bugs being investigated
- **patterns_active** — Reusable patterns used in this session
- **next_steps** — 2–3 concrete next actions

Example:
```yaml
version: 1
updated: "2026-05-09"

current_focus:
  - "Build compliance export feature (audit trail, PDF + CSV)"
  - "Fix SMTP SSL timeout on port 465"

recent_changes:
  - "2026-05-08: Feature gates Phase 3 merged; Redis invalidation wired"
  - "2026-05-07: Config service refactored; 5× faster reads"

open_blockers:
  - "PR #147 waiting on security review (critic-opus backlog)"

decisions_recent:
  - "Use PostgreSQL window functions for audit aggregation (cheaper than app-level sorting)"

next_steps:
  - "Run `/review` on compliance export before opening PR"
  - "Update architecture docs with new audit flow"
```

### 4.2 The Archives — Where Detail Lives

For durable knowledge, use detailed markdown archives:

| Archive | Contents | When to Update |
|---------|----------|-----------------|
| `.claude/memory/decisions.md` | Major design decisions with rationale and date | After any `/analyze` that resulted in a choice |
| `.claude/memory/bugs.md` | Root causes of fixed bugs, prevention notes | After `/fix` completes |
| `.claude/memory/patterns.md` | Reusable implementation patterns, examples | When you invent a pattern used 2+ times |
| `.claude/memory/context.md` | Expanded session context (e.g., "we're refactoring auth for SOC2") | Rarely; only when session has deep context |

These are **not auto-loaded**. You load them explicitly with `@` when you need them:
```
@.claude/memory/decisions.md

What design decisions have we made about caching?
```

### 4.3 /update-memory and /session-summary Cadence

Use these commands at the end of meaningful work sessions:

- **`/update-memory`** — Updates `active.yaml` with current session facts. Prompts you for changes.
- **`/session-summary`** — Writes a one-page summary of what was accomplished, issues hit, and next steps. Good for handing off to a teammate.

**Cadence:**
- After `/feature` completes → run `/update-memory` to record the change.
- After a long session (>2 hours or 3 subagents) → run `/session-summary` for the record.
- At end of day/week → optionally `/update-memory` to keep `active.yaml` fresh.

### 4.4 What NOT to Put in Memory

Don't record:
- **Code snippets** — Reference files instead. Files don't go stale; pasted code does.
- **Logs or errors** — Record the **diagnosis** ("SMTP cert validation failed"), not the 500-line traceback.
- **Minor implementation details** — Whether you used `list` or `deque` internally. Record the **pattern** ("use async context managers for resource cleanup").
- **Secrets** — Never. `.env` files and credentials are off-limits.

---

## 5. Spec-Driven Development (Stages 1–4)

The project uses a spec-driven workflow: write requirements, clarify with AI, generate spec, implement with tests, review against spec.

### 5.1 The Four Stages and Which Are AI vs Human

| Stage | AI or Human? | Output |
|-------|-------------|--------|
| **1: Requirements Clarification** | AI | User stories, constraints, open questions |
| **2: Design** | Human | Architecture diagrams, data flow, system boundaries |
| **3: Spec Generation** | AI | Formal EARS requirements, BDD scenarios, acceptance criteria |
| **4a: Implementation** | AI + Human | Code with passing tests (TDD) |
| **4b: Review** | AI | Code verified against spec compliance |

**Pipeline:** 1 (AI) → 2 (you) → 3 (AI) → 4a (AI) → 4b (AI) → you commit.

### 5.2 /spec-stage1, /spec-requirements, /spec-stage4-implement, /spec-stage4-review

Four commands bridge the spec workflow in Claude Code:

**`/spec-stage1`** — AI clarifies raw requirements
- Input: Stakeholder notes, sketches, vague ideas
- Output: Structured requirements with user stories and open questions
- Time: 5–10 minutes
- What to do: Review the output, answer any questions, iterate with AI

**`/spec-requirements`** — AI generates formal spec from requirements and design
- Input: Requirements document and design notes
- Output: Formal specification with EARS requirements and BDD scenarios
- Time: 10–15 minutes
- What to do: Review the spec, iterate if needed for clarity before implementation

**`/spec-stage4-implement`** — AI implements from a spec using TDD
- Input: A spec file (`.spec.md`) or design notes
- Output: Working code with passing tests
- Time: 10–30 minutes depending on scope
- What to do: Review code, run tests, iterate if needed

**`/spec-stage4-review`** — AI audits code against the spec
- Input: Changed code and the spec file
- Output: Pass/fail on each requirement, specific violations if any
- Time: 5–15 minutes
- What to do: If violations found, iterate code → review until spec passes

### 5.3 What "Load-Bearing Tests Only" Means in Practice

This project enforces a strict testing rule: **write only tests that would fail if the feature broke in a way that hurts users.** 

Before you (or the builder) write a test, answer all four:

1. **Failure signal** — Would this test fail if a realistic bug were introduced?
2. **User-visible consequence** — Would a user notice if the feature broke?
3. **Non-redundant** — Is there no other test that would already catch this bug?
4. **Not testing the framework** — Am I testing my code, or Pydantic/FastAPI/SQLAlchemy?

If you can't answer "yes" to all four, drop the test. Examples:

**Drop these:**
- `assert user.name == "test"` after `user = User(name="test")` — framework echo
- `assert response.status_code == 200` with no assertion about the body — framework behavior
- `assert isinstance(x, str)` when the signature says `str` — type system redundancy
- `mock.assert_called_once()` with no assertion about what the code did with the result — mock tautology

**Keep these:**
- Integration test: create user, check they can log in, verify token in session — user-visible flow
- Boundary test: pass empty string to name field, verify validation error — spec compliance
- Regression test: reproduce the exact bug from the ticket, verify fix works, verify it stays fixed

**Budget:** For a typical feature (multi-file), target 3–7 tests total. Ceiling is ~10. For a bug fix, exactly 1 regression test. If you exceed ceiling without justification, architect or reviewer will push back.

---

## 6. For Non-Claude-Code Users (Copilot, Cursor, Kilo, ChatGPT)

This project's routing and pipeline is built for Claude Code, but the underlying workflow is tool-agnostic. If you use GitHub Copilot, Cursor, Kilo, or ChatGPT, you can replicate most of the pipeline manually.

### 6.1 Why We Have Parallel Prompts

The project stores tool-agnostic prompts in `project_docs/spec-driven/prompts/`:
- `01-stage1-requirements-clarification.md`
- `02-stage3-spec-clarification.md`
- `03-stage3-spec-generation.md`
- `04-stage4-implementation.md`
- `05-stage4-review-gate.md`

These let any AI assistant run the spec-driven workflow. They're the "human-readable" version of what Claude Code's `/spec-stage*` commands do automatically.

### 6.2 Mapping: Claude Code Command → Tool-Agnostic Prompt File

| Claude Code Command | Tool-Agnostic Prompt | What You Do |
|-------------------|-------------------|-----------|
| `/spec-stage1` | `01-stage1-requirements-clarification.md` | Copy the prompt, paste into Copilot/ChatGPT, fill in `[PASTE...]` blanks |
| `/spec-requirements` (clarification phase) | `02-stage3-spec-clarification.md` | Same |
| `/spec-requirements` (generation phase) | `03-stage3-spec-generation.md` | Same |
| `/spec-stage4-implement` | `04-stage4-implementation.md` | Same |
| `/spec-stage4-review` | `05-stage4-review-gate.md` | Same |

**Example (Copilot):**
1. Open `project_docs/spec-driven/prompts/01-stage1-requirements-clarification.md`
2. Copy the prompt body (text between the triple backticks)
3. In GitHub Copilot Chat, paste the prompt
4. Replace `[PASTE YOUR STAKEHOLDER NOTES HERE]` with your actual stakeholder notes
5. Send
6. Review the output; this becomes your `requirements.md`

### 6.3 What You Lose Without Subagent Routing

**Claude Code advantage:**
- Automatic model selection (Opus for analysis, Sonnet for code, Haiku for writing)
- Automatic parallelization (run builders 1–3 in parallel for 3× speed)
- Automatic chaining (architect → builder → reviewer → writer, no manual handoffs)
- Automatic cost optimization (COMPACT mode for agent-to-agent, STANDARD for user)

**Copilot/Cursor/Kilo/ChatGPT:**
- You pick the model (or tool defaults to one)
- You run tasks sequentially (no parallelization)
- You copy outputs between prompts manually (or paste-bomb context)
- You don't get inter-agent COMPACT mode (everything is verbose)

**Cost impact:** Without automation, expect 30–50% higher token spend (more repetition, longer context, sequential not parallel).

### 6.4 Bridging: How to Mimic the Pipeline Manually

If you're on Cursor and want to build a feature:

**Step 1: Analyze (architect-like)**
1. Open `.claude/memory/active.yaml` and copy recent context
2. In Cursor, open prompt `02-stage3-spec-clarification.md`
3. Paste the prompt, fill in design notes, send
4. Get back clarifying questions; answer them
5. Save clarifications to a file (e.g., `design-notes.md`)

**Step 2: Design (your job, no AI)**
1. Sketch the data flow, API endpoints, database schema
2. Write design notes in `design-notes.md`

**Step 3: Spec (architect-like)**
1. Open prompt `03-stage3-spec-generation.md`
2. Paste the prompt, fill in `[PASTE HERE]` with your design notes
3. Get back a formal spec (`audit-export.spec.md`)
4. Save the spec to `docs/spec/`

**Step 4: Implement (builder-like)**
1. For each independent piece (API endpoint, migration, tests):
   - Open prompt `04-stage4-implementation.md`
   - Paste the prompt, fill in scope
   - Implement one piece
   - Save code to files
2. Run `uv run pytest` to verify tests pass
3. Run `uv run ruff check .` for lint

**Step 5: Review (reviewer-like)**
1. Open prompt `05-stage4-review-gate.md`
2. Paste the prompt, fill in the spec and your implementation
3. Get back compliance report (pass/fail on each spec requirement)
4. If failures, iterate code → review until pass

**Step 6: Commit**
```bash
git add app/ tests/ alembic/
git commit -m "Add audit export feature"
```

**Time: 30–60 minutes.** With Claude Code, the same feature is 15–30 minutes (parallelization + automation).

### 6.5 House Rules That Apply Regardless of Tool

These rules apply whether you use Claude Code, Copilot, or ChatGPT:

1. **Load-bearing tests only** — Reference `.claude/rules/testing.md` for the budget and filter.
2. **File references, not paste-bombs** — >150 lines? Save to a file and say `@filename.md`.
3. **Spec review gate before PR** — Run `/spec-stage4-review` (or equivalent prompt) before opening a pull request.
4. **Update architecture docs on contract changes** — If you change API endpoints, database schema, or service APIs, update `docs/architecture/system-model.yaml`.
5. **Record decisions and bugs** — Use `/record-decision` or `/update-memory` to keep `active.yaml` and the decision archive current.

---

## 7. Troubleshooting

### 7.1 "My critic-opus run is taking forever"

Critic is slow when it reads a large diff (10+ files). **Solution:**

Scope `/review` to the smallest directory or file that captures the diff. For example:
```
/review app/services/auth.py
```

Instead of reviewing the entire repo with `/review`, focus on the changed files. Fast automated checks (ruff, mypy, pytest) run first; if they pass, critic likely will too.

### 7.2 "`/fix` currently routes through `bug-fixer-sonnet`"

The `/fix` command currently routes directly to `bug-fixer-sonnet` for implementation. The `debugger-buddy` agent referenced in CLAUDE.md routing has no implementation file yet — this is a pending follow-up. Bug diagnosis and fix still work as designed; only the agent specialization is not yet separated.

### 7.3 "Builder went off-scope"

If a builder starts implementing beyond what the plan said, you'll see `BLOCKER:` in their output. **Protocol:**

1. **Halt** — Do not merge the code.
2. **Clarify** — Ask the builder: "Scope lock: focus only on X and Y. Drop Z."
3. **Re-run** — Builder will revert Z and recommit.
4. **Escalate if needed** — If the builder insists Z is necessary, re-engage architect to re-plan.

### 7.4 "Cost spiked this week"

Look for these patterns in your transcript:

- **Repeated context** — Running `/feature` → `/feature` → `/feature` without `/compact`. Each run re-reads the entire project. **Fix:** Run `/compact` between features.
- **Paste-bombs** — Pasting 1000-line logs or specs into chat. **Fix:** Save to file, use `@file`.
- **Broad reads** — Builder reading whole 1000-line files instead of diffs. **Fix:** Ask builder to read only the changed sections (`offset`/`limit`).
- **Verbose spec docs** — Writing specs with 50-page prose instead of 5-page bullets. **Fix:** Reference `.claude/rules/docs.md` for conciseness.
- **Overly detailed critic reviews** — Critic outputting 8000-token reviews for simple changes. **Fix:** Run python-reviewer first; if it passes, skip critic.

---

## 8. Reference Card

### 8.1 Command Cheat Sheet

#### Pipeline & Memory Commands

| Command | Purpose | Model(s) | Time |
|---------|---------|----------|------|
| `/feature <desc>` | Build a feature end-to-end | Architect → Builders → Critic → Writer | 15–45m |
| `/fix <bug>` | Diagnose and fix a bug | Bug-fixer → Critic | 10–25m |
| `/analyze <q>` | Deep architecture analysis | Architect | 5–15m |
| `/implement <plan>` | Code from a plan | Builders (parallel) → Critic | 10–30m |
| `/review [files]` | Security + correctness audit | Python-reviewer → Critic | 5–20m |
| `/spec-stage1` | Clarify raw requirements | Architect | 5–10m |
| `/spec-requirements` | Generate formal spec | Writer | 10–15m |
| `/spec-stage4-implement` | Implement from spec (TDD) | Builders → Critic | 10–30m |
| `/spec-stage4-review` | Audit code against spec | Critic | 5–15m |
| `/update-memory` | Update `active.yaml` | (Skill) | 2–5m |
| `/session-summary` | Write session recap | Writer | 2–5m |

#### Built-in Claude Code CLI

| Command | Purpose |
|---------|---------|
| `/compact` | Squash context, keep memory alive |
| `/clear` | Wipe conversation history (start fresh) |
| `/help` | Show available skills and commands |
| `/memory` | View or update personal session memory |
| `/model` | Switch Claude model for this session |

### 8.2 Agent Cheat Sheet

| Agent | Model | When to Use | When NOT to Use | Cost Driver |
|-------|-------|-----------|----------------|-------------|
| architect-opus | Opus | `/feature`, `/analyze`, design decisions | For trivial single-file changes | Output length (analysis is verbose) |
| builder-sonnet | Sonnet | `/feature`, `/implement`, code work | Planning (use architect for that) | File count read |
| bug-fixer-sonnet | Sonnet | `/fix`, minimal surgical changes | Exploring root cause (use general analysis for that) | Always focused; low cost |
| critic-opus | Opus | Security/correctness review, gating | Routine lint (python-reviewer faster) | Diff size + test output |
| writer-haiku | Haiku | Specs, docs, summaries, changelogs | Code implementation | Output length (usually small) |
| python-reviewer | Sonnet | Fast pre-check before critic | Never; run it always before critic | File count |

### 8.3 File Map

| File | Purpose | Update When |
|------|---------|-------------|
| `.claude/CLAUDE.md` | Root routing rules + token discipline | Architecture changes |
| `.claude/rules/core.md` | Universal rules (memory, planning, security) | Never (part of spec) |
| `.claude/rules/testing.md` | Test policy (load-bearing, budget, ban list) | Never (part of spec) |
| `.claude/memory/active.yaml` | Current focus, blockers, recent changes | After each session (`/update-memory`) |
| `.claude/memory/decisions.md` | Design decisions with rationale | After `/analyze` producing a choice |
| `.claude/memory/bugs.md` | Root causes + fixes + prevention | After `/fix` completes |
| `.claude/memory/patterns.md` | Reusable patterns, examples | When a pattern is used 2+ times |
| `.claude/agents/*.md` | Agent prompts + model selection | Never (auto-loaded) |
| `.claude/commands/*.md` | Pipeline command specifications | Never (auto-loaded) |
| `docs/architecture/system-model.yaml` | System architecture (AI context) | After API/schema/service changes |
| `docs/architecture/architecture-compact.md` | Quick reference (human) | After API/schema/service changes |
| `docs/architecture/architecture-summary.md` | 2KB overview | After major changes |
| `.claude/CHANGELOG_AI.md` | Implementation history (unreleased + archive) | After `/feature`, `/fix` (writer auto-updates) |
| `project_docs/spec-driven/prompts/*.md` | Tool-agnostic AI prompts | Never (reference only) |

---

## Closing

The pipeline is designed to save you time and money: automation handles routing, parallelization, and chaining. Your job is to frame good questions, approve plans, and commit working code.

**Golden rules:**
- Use `/feature` for features, `/fix` for bugs, `/analyze` for decisions.
- Approve the plan before implementation starts.
- Use `/compact` after 3 subagents.
- Paste files, don't paste content (>150 lines).
- Keep `active.yaml` lean; archives hold the detail.
- Run `/review` before opening a PR.

Questions? Check the command files in `.claude/commands/` for detailed protocol. Run `/help` in Claude Code for the full skill list.
