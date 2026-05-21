<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 12 — SDLC & CI/CD Pipeline: AI-Augmented Software Delivery, End to End

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies:** Assignment §2.1 *"Complete a working product"* + the **initial-call interview question**: *"How will you use AI inside the SDLC?"*
**Audience:** Hiring panel, tech lead, security reviewer.
**Architecture refs:** [01 RADAR](../../docs/analysis/01-radar-analysis.md) · Spec 11 (AI governance) · `.claude/commands/spec-stage*.md` (workflow files)

---

## 1. What this feature is

This is the spec that turns "we use AI to code" into a *demonstrable, auditable, automated* operating model. It defines the **full lifecycle** a change goes through, from the requirement being captured to the production deployment being observable — and shows **exactly where AI is in the loop**, what it's allowed to do, and how its work is gated by humans, evals, and automated checks.

It is implemented entirely on **GitHub Actions free tier** + **Vercel Preview** + **Neon database branches**. No paid CI runners. No proprietary platform lock-in beyond what's already in the stack.

The goal of this artifact: a hiring panel reading the repo can answer *"would I trust this team to ship AI-using software at portfolio scale?"* — yes.

> **Value beyond the brief.** Not asked in the brief; it is **the question they asked on the initial call** for the AI Engineering Manager role at Valsoft. This spec is the answer in the form a manager would actually run. (See [valsoft_context memory](../../.claude/memory/valsoft_context.md) for context.)

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **SDLC** | Software Development Lifecycle — the named stages a change moves through (requirement → design → build → test → deploy → operate). |
| **Spec gate** | A CI check that fails the build if a PR touches feature code but no matching spec exists / is approved. |
| **Eval gate** | A CI check that runs the AI eval suite and fails the build on quality regression (Spec 11). |
| **Preview environment** | A short-lived deployment of the branch, with its own Neon database branch, accessible at a stable URL. |
| **AI-PR label** | `ai-generated-pr` label applied automatically when >80% of the diff was AI-authored, so human reviewers know to apply extra scrutiny. |
| **Provenance marker** | The `<!-- written-by: ... | model: ... -->` HTML comment on the first line of writer-haiku docs (per `.claude/rules/docs.md`). |
| **Trunk** | The `main` branch. Always deployable. |
| **Operator runbook** | A doc under `runbooks/` that an on-call engineer follows during an incident. |

## 3. The end-to-end lifecycle of a change (top-down map)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                        Stack SDLC — one change end-to-end                       │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   STAGE 1: REQUIREMENTS         ──►   docs/analysis/* + project_docs/specs/*    │
│   /analyze ▸ architect-opus                                                     │
│             (RADAR methodology, epistemic tags)                                 │
│   Output: a signed spec under project_docs/specs/.                              │
│   Human gate: PO sign-off block in each spec.                                   │
│                                                                                 │
│   STAGE 2: DESIGN NOTES (HUMAN-ONLY, no AI)                                     │
│   project_docs/specs/_design-notes/*.md                                         │
│   Tech lead sketches data + flow; AI is forbidden here on purpose.              │
│                                                                                 │
│   STAGE 3: SPEC GENERATION                                                      │
│   /spec-requirements ▸ writer-haiku                                             │
│   Produces team-readable spec.md + DOCX. Provenance marker required.            │
│                                                                                 │
│   STAGE 4a: IMPLEMENTATION                                                      │
│   /spec-stage4-implement ▸ architect-opus → builder-sonnet (TDD)                │
│   RED → GREEN → REFACTOR. One BDD scenario = one Vitest/Playwright test.        │
│                                                                                 │
│   STAGE 4b: AI CODE REVIEW (automatic before PR opens)                          │
│   /spec-stage4-review ▸ critic-opus                                             │
│   Coverage matrix BDD↔test; NFR enforcement; scope-creep; security scan.        │
│   Verdict must be APPROVED before a PR opens.                                   │
│                                                                                 │
│   STAGE 5: PULL REQUEST + CI                                                    │
│   GitHub Actions runs the pipeline defined in this spec.                        │
│   Preview env on Vercel + isolated Neon branch.                                 │
│   Two human reviewers (per CODEOWNERS).                                         │
│                                                                                 │
│   STAGE 6: MERGE & DEPLOY                                                       │
│   Squash-merge to main. Vercel auto-deploys to production.                      │
│   Migrations apply with safety guard (Spec 12 §5 REQ-12-08).                    │
│                                                                                 │
│   STAGE 7: OPERATE                                                              │
│   Sentry + Langfuse + Vercel logs + Edge Config feature flags.                  │
│   Operator runbooks; kill switches per AI feature (Spec 11).                    │
│                                                                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 4. The CI pipeline at a glance (GitHub Actions)

```
.github/workflows/
├── ci.yml                  # PR pipeline — required for merge
├── eval-ai.yml             # AI eval gate (runs on AI-touching PRs only)
├── deploy-preview.yml      # Vercel preview + Neon branch
├── deploy-prod.yml         # Production deploy on main
├── nightly-quality.yml     # Lighthouse / accessibility / link check
├── security-weekly.yml     # CodeQL + dependency review
└── release-changelog.yml   # Changelog + release notes on tag
```

`ci.yml` jobs (each one independent unless noted):

| Job | Tool | What it asserts | Required to merge |
|-----|------|----------------|:-----------------:|
| `lint` | Biome (or ESLint+Prettier) | Style + unused-imports clean | ✓ |
| `typecheck` | `tsc --noEmit` | TypeScript strict pass | ✓ |
| `prompt-lint` | custom script | Prompt files have `version:` frontmatter (REQ-11-09) | ✓ |
| `unit-tests` | Vitest | Vitest passes; coverage ≥ 70% line / 60% branch (changed files) | ✓ |
| `integration-tests` | Vitest + Testcontainers Postgres (or a service-Postgres) | DB-touching tests pass against real Postgres | ✓ |
| `e2e-tests` | Playwright on preview URL | Golden-path Playwright passes | ✓ |
| `a11y` | axe-core on key pages via Playwright | No WCAG 2.2 AA violations on critical paths | ✓ |
| `lighthouse-ci` | LHCI on preview URL | Performance ≥ 80; A11y ≥ 95; SEO ≥ 95 (public catalog) | ✓ |
| `spec-gate` | custom script | Every changed feature file is referenced by an approved spec | ✓ |
| `cross-tenant-probe` | Vitest tagged | The cross-tenant probe (Spec 11 REQ-11-06) passes | ✓ |
| `migration-safety` | EF/Drizzle introspection + custom guard | No destructive migration without `safety:reviewed` label | ✓ |
| `dependency-review` | GitHub built-in action | No new high/critical CVE | ✓ |
| `secret-scan` | Gitleaks | No secrets in diff | ✓ |
| `codeql` | GitHub CodeQL | No new SAST findings High+ | weekly + on PR if changes ≥ N lines |
| `eval-ai` | Braintrust / Langfuse evals (separate workflow) | Per-feature thresholds met (Specs 05/06/07/08) | ✓ (only when `lib/ai/**` or `evals/**` change) |
| `bundle-size` | `next-bundle-analyzer` JSON | Per-route bundle delta < 50 KB or label `bundle-size:reviewed` | warn → block at 100 KB |
| `ai-pr-label` | custom action | Apply `ai-generated-pr` if >80% of diff lines AI-authored | informational |

> All jobs run on `ubuntu-latest` and stay within the GitHub-Actions free tier (2,000 min/month for private repos; unlimited public). Job-level concurrency cancels obsolete runs on push.

## 5. Functional requirements (EARS)

```
REQ-12-01: While a PR is open against `main`, the CI workflow `ci.yml` shall run all jobs marked Required and the
PR shall not be mergeable unless every required job is `success`.

REQ-12-02: When a PR is opened or updated, the `deploy-preview.yml` workflow shall (a) provision a Vercel preview
deployment, (b) create a Neon database branch from the latest `main` branch's branch, (c) run migrations against
the new Neon branch, (d) post the preview URL + DB branch name as a comment on the PR.

REQ-12-03: When a PR is closed, the matching Neon branch shall be deleted within 24 h via a scheduled cleanup
workflow.

REQ-12-04: When a PR touches files under `src/app/**` or `src/lib/**`, the `spec-gate` job shall walk
`project_docs/specs/*.spec.md`, build the set of paths each spec is responsible for (from a `tags:` frontmatter),
and fail if any changed file is not covered by an approved spec.

REQ-12-05: When a PR touches files under `lib/ai/**`, `evals/**`, or `lib/ai/prompts/**`, the `eval-ai.yml`
workflow shall run and the build shall fail if any eval gate is below threshold (Specs 05/06/07/08/11).

REQ-12-06: When a PR touches `lib/ai/prompts/**`, the `prompt-lint` job shall require (a) updated
`version: x.y` frontmatter in every changed prompt, (b) at least one corresponding ADR file added under
`docs/decisions/`.

REQ-12-07: When the PR diff contains lines that match the project's AI-authoring detection heuristic
(diff annotations + size), the `ai-pr-label` job shall apply the `ai-generated-pr` label and post a
template comment asking reviewers to focus on (1) architecture compliance, (2) edge cases, (3) silent regressions.

REQ-12-08: When a PR adds a database migration, the `migration-safety` job shall (a) detect destructive ops
(DROP TABLE/COLUMN, NOT NULL on populated columns), (b) require the label `safety:reviewed` to merge, (c)
otherwise pass.

REQ-12-09: When a push to `main` succeeds, `deploy-prod.yml` shall (a) deploy to Vercel production, (b) run
production migrations with `--idempotent` script, (c) run a post-deploy smoke test against the production URL,
(d) on smoke failure trigger an automatic rollback via Vercel's promotion API.

REQ-12-10: When a release tag is created (`v*.*.*`), `release-changelog.yml` shall use
Conventional Commits + the changes since the previous tag to generate release notes, populate the GitHub
Release body, and append a section to `CHANGELOG_AI.md` for AI-authored changes (writer-haiku).

REQ-12-11: While the project is in active development, the `nightly-quality.yml` workflow shall run nightly
at 02:00 UTC against the main preview URL and post a Slack/GitHub summary if any LHCI score drops below its
threshold.

REQ-12-12: When any required CI job fails, the failure annotation shall include a one-line summary, the
failing test/check, and a deep link into the run; no manual log diving should be required.

REQ-12-13: When a Dependabot PR is opened, CI shall run the full suite identical to a human PR; if the suite
passes and the change is patch-version, auto-merge after a 24-hour cool-down (configurable).

REQ-12-14: When CODEOWNERS is matched by changed files, two distinct human reviewers shall be required to merge
(GitHub branch-protection rule, defined declaratively in `.github/branch-protection.json` synced via a workflow).
```

## 6. Acceptance scenarios (BDD)

### REQ-12-01 — failing CI blocks merge
- **Given** a PR with a deliberately failing test
- **When** CI runs
- **Then** the failing job is reported; the Merge button is disabled
- **And** clicking Merge from API returns "Required status check failing".

### REQ-12-02 — preview env + Neon branch
- **Given** a PR is opened
- **When** the preview workflow completes
- **Then** the PR has a comment with `https://stack-pr-<n>-<sha>.vercel.app` and `neon-branch: <branch>`
- **And** opening the URL shows the change live
- **And** the preview talks to the Neon branch, not production.

### REQ-12-04 — spec-gate catches orphan code
- **Given** a PR adds `src/lib/feature/foo.ts` with no matching spec
- **When** spec-gate runs
- **Then** the job fails with `no spec covers src/lib/feature/foo.ts`
- **And** the suggested fix is to add a spec or to update an existing spec's `tags:` frontmatter.

### REQ-12-05 — eval gate fails on AI regression
- **Given** a PR changes `lib/ai/prompts/readers-advisor.md` and reduces refusal accuracy to 85%
- **When** `eval-ai.yml` runs
- **Then** the build fails with `readers_advisor refusal_accuracy=0.85 < 0.90`
- **And** the run output includes the failing scenarios for quick repro.

### REQ-12-07 — AI-PR label applied
- **Given** a PR where ≥ 80% of lines are AI-authored (detected via Claude Code provenance + diff annotation)
- **When** the labelling action runs
- **Then** the `ai-generated-pr` label is applied
- **And** a comment appears: "This PR is largely AI-authored. Please apply extra scrutiny to: architecture compliance, edge cases, silent regressions."

### REQ-12-08 — destructive migration requires label
- **Given** a PR adds `0042-drop-old-table.sql`
- **When** `migration-safety` runs
- **Then** the job fails with `destructive op detected: DROP TABLE — add label safety:reviewed`
- **And** adding the label re-runs the job to pass.

### REQ-12-09 — prod deploy with rollback
- **Given** a deploy completes but the post-deploy smoke test fails
- **When** the workflow handles the failure
- **Then** Vercel promotion is reverted to the previous deployment within 90 s
- **And** a Slack/GitHub alert links to the failed smoke run.

### REQ-12-10 — release notes
- **Given** a `v0.1.0` tag is pushed
- **When** the release workflow runs
- **Then** the GitHub Release body contains grouped Conventional Commit headlines + AI-authored summary
- **And** `CHANGELOG_AI.md` has a new section for the version.

### REQ-12-14 — two reviewers required
- **Given** a PR touches a CODEOWNERS-matched path
- **When** only one approval exists
- **Then** the Merge button is disabled with "1 of 2 required approvals".

## 7. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-12-01 | CI is fast | Median PR CI wall-clock ≤ 10 minutes (parallelized). | 10 min p50 |
| NFR-12-02 | CI is cheap | Monthly Actions minutes ≤ 80% of free tier for the primary developer. | 1,600 min/mo cap |
| NFR-12-03 | Preview env is fast | Preview deployment from push to URL ready ≤ 4 minutes. | 4 min |
| NFR-12-04 | Production deploy + smoke ≤ 5 min | Deploy + migrations + smoke ≤ 5 minutes. | 5 min |
| NFR-12-05 | Rollback is fast | Rollback (auto or manual) completes ≤ 90 s. | 90 s |
| NFR-12-06 | No secrets in CI logs | When a secret is accidentally echoed, GitHub's secret masking shall hide it; PR comment never exposes raw values. | Verified by red-team test |
| NFR-12-07 | Eval-AI cost predictable | Eval-AI workflow average cost ≤ $0.50 per run. | $0.50 |
| NFR-12-08 | Required reviews enforced | Branch protection rules synced from `.github/branch-protection.json` so they can't drift. | Verified by CI policy job |
| NFR-12-09 | Failure annotations actionable | When a CI job fails, the GitHub annotation shall include a one-line summary + a deep link to the failing test. | Manual review on three sample failures |

## 8. Edge cases

- A PR opens with no diff (label-only change) → CI still runs lightweight subset; spec-gate is skipped.
- A PR adds files under `docs/**` only → unit/integration/e2e skipped; lint + a11y on rendered docs still run.
- Fork-based PR (external contributor — n/a for a private interview repo, but designed for it) → secrets are scoped; eval-AI does not run (no LLM keys).
- A migration is irreversible but tagged `safety:reviewed` → CI passes; runbook entry is required (warned by a job, not blocked).
- Neon branch quota reached → cleanup workflow extended to delete branches > 14 days old.
- Eval suite times out on GitHub free tier → eval suite chunked across 3 parallel matrix runners; budget guard kicks in at 20 min wall-clock.
- Vercel preview limits — projects support concurrent previews; if reached, the workflow waits.

## 9. AI-in-SDLC: where AI lives in this pipeline (the interview question, answered)

| Stage | Where AI is in the loop | What controls it |
|-------|--------------------------|------------------|
| Requirements | `architect-opus` runs RADAR analysis; epistemic tags `[VERIFIED]`/`[ASSUMPTION]` mark confidence; human PO signs off | Spec sign-off block; ADR for any model output adopted |
| Design notes | **Forbidden** — human-only stage | `.claude/commands/spec-stage1.md` explicit "no AI involvement" |
| Spec generation | `writer-haiku` writes; provenance marker required | `.claude/rules/docs.md` + `verify-writing` slash-command |
| Implementation | `builder-sonnet` with TDD (RED → GREEN → REFACTOR), bounded by scope of one spec | `.claude/rules/testing.md` load-bearing-tests-only policy |
| Code review | `critic-opus` runs automatically before PR opens | `/spec-stage4-review` workflow; APPROVED verdict required |
| CI | Spec gate, eval gate, AI-PR label, cross-tenant probe | Required GitHub Actions jobs (this spec) |
| Production | Langfuse spans, Edge Config kill switches, per-tenant cost cap, refusal eval gates | Spec 11 |
| Postmortem | `architect-opus` co-authors RCAs from Sentry + Langfuse traces; human signs off | `record-bug.md` + `record-decision.md` slash-commands |

This matrix is the **answer to "how will you use AI in the SDLC"** — concrete, gated, and reproducible.

## 10. Required GitHub repo configuration

To make this spec actually enforceable, the repo needs:

- **Branch protection on `main`**
  - Require 2 approvals (CODEOWNERS)
  - Require all required status checks above
  - Require linear history (squash merges only)
  - Restrict force-push and deletion
  - Required signed commits — yes
- **Required status checks** — listed in `ci.yml` (REQ-12-01)
- **CODEOWNERS** under `.github/CODEOWNERS` — at minimum, `lib/ai/**` requires AI-reviewer approval; `infra/**` requires platform owner
- **Secrets** (GitHub repo secrets):
  - `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
  - `NEON_API_KEY`
  - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (for eval-AI; scoped to `main` and PRs from same repo)
  - `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`
  - `RESEND_API_KEY`
- **Labels**:
  - `ai-generated-pr` (auto-applied)
  - `safety:reviewed` (manual on destructive migration)
  - `focus-review:architecture`, `focus-review:security`, `focus-review:ux`
  - `bundle-size:reviewed`
- **Dependabot**: weekly schedule, grouped by ecosystem
- **Renovate** (alternative; either/or)

## 11. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-12-01 | Branch protection JSON synced via workflow vs Terraform — Actions workflow is the simpler option for a free-tier setup; recommend. | [NON-BLOCKING] — recommend Actions workflow |
| Q-12-02 | Slack vs Discord vs GitHub-only notifications for CI failures? | [NON-BLOCKING] — recommend GitHub-only for solo build, Slack later |
| Q-12-03 | Should we run integration tests on a real Neon branch or Testcontainers Postgres? Real Neon is closer to prod; TC is faster. | [NON-BLOCKING] — TC for unit/integration; Playwright E2E hits the preview's real Neon |
| Q-12-04 | Auto-merge Dependabot patch PRs after 24 h, or require human review? | [NON-BLOCKING] — auto-merge patch, manual minor/major |
| Q-12-05 | Should we publish CHANGELOG_AI.md to a public docs site? | [NON-BLOCKING] — v2 |
| Q-12-06 | Add SBOM generation (CycloneDX) and supply-chain attestation? | [NON-BLOCKING] — recommend yes, adds <30 s to CI |

## 12. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **Platform / DevOps:** ___________
- [ ] **Security reviewer:** ___________
- [ ] Date approved: ___________

---

### Demo notes for the hiring panel

When you watch the demo video (Bonus §3.2) and visit the live URL, what you can do:

1. **Open the repo's Actions tab** — see real green check-marks on every PR commit, including spec-gate, eval-ai, cross-tenant-probe.
2. **Open any PR** — see the comment with the preview URL + Neon branch.
3. **Open the AI-PR-labelled PR** — see the auto-applied label + comment.
4. **Open `docs/decisions/`** — see ADRs that gated AI prompt changes.
5. **Open Langfuse** (link in README) — see real production traces tagged by tenant and feature.
6. **Open the AI Usage dashboard** — see the cost breakdown live (Spec 08).

This is the whole story: AI authored a lot of this product, and the SDLC pipeline made that **safe and inspectable** — not faster-at-the-cost-of-quality, but faster *and* better.
