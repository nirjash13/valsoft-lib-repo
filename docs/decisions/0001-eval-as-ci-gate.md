<!-- written-by: writer-haiku | model: haiku -->
# ADR-0001 — Eval-as-CI-Gate Over Manual Prompt Review

**Date:** 2026-05-21  
**Status:** Accepted  
**Deciders:** AI Engineering Manager + Platform lead

## Context

Stack uses AI in production across multiple features (Reader's Advisor, ISBN enrichment, search, notifications drafts). Each AI feature can silently degrade if its prompt or model drifts — for example, a refusal-accuracy regression in Reader's Advisor would allow off-catalog questions to be answered with customer data, or a weakening of the cross-tenant probe would leak data between tenants.

Manual code review cannot detect silent quality regressions because:
1. Prompt changes are small, superficially safe text edits
2. Quality metrics (refusal accuracy, factuality, hallucination rate) only emerge from running real dialogue scenarios
3. A human reviewer reading a prompt change has no statistical confidence in outcomes — only the eval can provide that

Therefore, any prompt change must be validated by running the actual eval suite against the new prompt before the build can pass (Spec 11 REQ-11-05, REQ-11-09).

## Decision

Implement eval-as-CI-gate: every feature with an AI surface (Specs 02, 05, 06, 07, 08, 10) owns an eval dataset under `evals/<feature>.dataset.json`. When CI runs on a PR that touches `lib/ai/prompts/**` or `evals/**`:

1. The `eval-ai.yml` workflow runs Braintrust evals against the feature-specific datasets using the branch's prompts and models.
2. Each feature declares a per-metric threshold in its spec (e.g., readers_advisor refusal_accuracy >= 0.90).
3. The build **fails** if any metric is below threshold.
4. A prompt-file change requires: version bump in the YAML frontmatter, passing eval run at the new version, and an ADR entry documenting the change rationale.

This gate is enforced in the required GitHub Actions jobs (Spec 12 REQ-12-05, REQ-12-06).

## Consequences

### Positive
- **Silent regressions become visible** — a prompt softening that reduces refusal accuracy is caught before merge, not discovered in production.
- **Eval quality improves over time** — each feature's eval dataset is the source of truth; it is revisited and refined with each prompt iteration.
- **ADR trail documents intent** — a reader can see why Reader's Advisor v1.1 was bumped (e.g., "reduced hallucination on off-catalog queries") and trace the decision.
- **Cross-tenant safety is continuous** — the cross-tenant probe runs on every eval cycle; data isolation regressions fail the build.

### Negative
- **Eval suite must run in CI** — adds 5–10 minutes to PR feedback loop (NFR-12-01 target: 10 min median). Mitigated by parallel matrix runners (3 concurrent chunks).
- **Eval datasets require curation** — they are not auto-generated; they must be written by hand with expected outputs. Initial cost per feature is ~2 hours.
- **Eval thresholds can be gamed** — a developer could lower a threshold to make a failing eval pass. Mitigated by code review + ADR requirement; CODEOWNERS can reject threshold-lowering PRs.
- **Model swaps affect all evals** — if routing.ts switches from Sonnet to Haiku, all evals must re-baseline or thresholds must be adjusted. Mitigated by versioning prompts + thresholds per model combination.

## Alternatives considered

1. **Manual code review only** — rejected because silent quality regressions would reach production (Spec 11 REQ-11-05, US-03).
2. **Automated metric telemetry in production** — rejected because it detects regressions post-deploy, not pre-merge; introduces latency and complexity.
3. **Eval gates on main only, not on PR** — rejected because feedback loop is too slow (days vs. minutes).
4. **Single global eval suite** — rejected because features have different quality concerns (refusal vs. relevance vs. latency); per-feature datasets allow targeted thresholds.

## References

- Spec 11 § 5 REQ-11-05, REQ-11-09 — eval gates and prompt versioning
- Spec 12 § 5 REQ-12-05, REQ-12-06 — CI pipeline jobs
- Implementation: `evals/readers-advisor.dataset.json`, `evals/run-evals.mjs`, `.github/workflows/eval-ai.yml`
