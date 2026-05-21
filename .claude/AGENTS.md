# AGENTS.md — Agent Architecture & Orchestration

## Runtime Model Pins

| Agent | Model | Role | Mode |
|---|---|---|---|
| `architect-opus` | Opus | Analysis, architecture, tradeoffs | Plan (read-only) |
| `builder-sonnet` | Sonnet | Implementation, TDD, refactoring | Full access |
| `bug-fixer-sonnet` | Sonnet | Surgical bug fixes after diagnosis | Full access |
| `critic-opus` | Opus | Security/correctness review | Plan (read-only) |
| `debugger-buddy` | Sonnet | Bug diagnosis, root-cause analysis | Read + bash |
| `writer-haiku` | Haiku | Documentation, plans, summaries | Full access |
| `dotnet-reviewer` | Sonnet | Automated .NET build/test/format/vuln checks | Read + bash |

## Writing Enforcement
- Markdown artifacts (`*.md`) owned by `writer-haiku` unless human overrides.
- Provenance marker required: `<!-- written-by: writer-haiku | model: haiku -->`
- Verify: `dotnet-reviewer` runs `dotnet format --verify-no-changes` for C# files.

## Orchestration Flow

```
┌─────────────────────────────────────────┐
│            HUMAN OPERATOR               │
│        (Approve / Reject / Clarify)     │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────┐
│      ARCHITECT (Opus)       │
│  RADAR analysis → plan      │
│  Parallelization guidance   │
└──────────────┬──────────────┘
               │ (approval gate)
┌──────────────▼──────────────┐
│    BUILDER(S) (Sonnet)      │
│  Parallel task groups       │
│  TDD: RED → GREEN → REFACTOR│
└──────────────┬──────────────┘
               │ (automatic)
┌──────────────▼──────────────┐
│      CRITIC (Sonnet)        │
│  Security + correctness     │
│  APPROVE / REQUEST CHANGES  │
└──────────────┬──────────────┘
               │ (if issues → fix → re-review)
┌──────────────▼──────────────┐
│      WRITER (Haiku)         │
│  Changelog + docs update    │
└──────────────┬──────────────┘
               │
            ✅ Done
```

## Pipeline Commands

| Command | Pipeline | When to Use |
|---|---|---|
| `/feature <desc>` | Architect → Approve → Builder(s) → Critic → Simplify → Writer | New features, multi-file changes |
| `/analyze <problem>` | Architect (RADAR) → Present plan | Architecture decisions, design analysis |
| `/implement <plan>` | Builder(s) parallel → Critic auto-review | Execute an existing plan |
| `/review [files]` | Critic + automated tooling | Pre-merge review |
| `/fix <bug>` | Debugger → Bug-fixer → Critic → Document | Bug investigation and fix |

## Workflow Patterns

### Pattern A: New Feature (Full Pipeline)
```
/feature "Add user notifications"
  → architect-opus analyzes, produces parallelized task plan
  → user approves
  → builder-sonnet(s) implement in parallel groups
  → critic-opus auto-reviews → fix loop if needed
  → /simplify checks for unnecessary complexity
  → writer-haiku updates changelog + docs
```

### Pattern B: Bug Fix
```
/fix "Login timeout error on refresh token"
  → debugger-buddy diagnoses root cause
  → bug-fixer-sonnet writes regression test + minimal fix
  → critic-opus reviews
  → bugs.md updated
```

### Pattern C: Quick Task (Builder Only)
```
Direct request → builder-sonnet implements → critic-opus auto-reviews
```

### Pattern D: Architecture Decision
```
/analyze "Should we use Redis or PostgreSQL for session storage?"
  → architect-opus: landscape research, 3 approaches, pairwise comparison
  → recommendation with confidence level + pre-mortem
```

## Escalation Rules

### Builder → Architect
- Plan doesn't match reality
- Discovered requirement not in spec
- Need new dependency
- Implementation >50% larger than planned

### Critic → Human
- CRITICAL security vulnerability
- Spec violation
- Architectural deviation
- >5 warnings in single file

### Any Agent → Human
- Uncertainty about business logic
- Multiple valid approaches (no clear winner)
- Breaking change to public API
- Data migration required

## Auto-Review Policy
`critic-opus` runs automatically after EVERY implementation, whether from `/feature`, `/implement`, `/fix`, or direct builder work. No manual trigger needed. The review loops (fix → re-review) until APPROVE verdict.

## Cost Optimization
- Opus (architect + critic): analysis/planning + review — higher capability where reasoning matters
- Sonnet (builders): primary workhorse — parallel agents for independent tasks
- Haiku (writer): documentation — cheapest for text generation
- Critic reviews are shorter output than architect analysis, keeping Opus cost reasonable
- Cache architecture docs across agent spawns
- Batch critic reviews (all files at once, not per-file)
