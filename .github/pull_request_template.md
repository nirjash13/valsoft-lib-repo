## Summary

<!-- 2–4 sentences describing what this PR does and why. -->

## Linked spec

<!-- Which spec(s) does this change satisfy? -->
- Spec: `project_docs/specs/<NN>-<feature>.spec.md`
- REQ / NFR IDs addressed:

## Test plan

- [ ] `pnpm typecheck` passes (zero errors)
- [ ] `pnpm biome:check` passes (zero issues)
- [ ] `pnpm test:unit` passes
- [ ] `pnpm test:integration` passes (or skipped with justification if no DB-touching change)
- [ ] New behavior is covered by a load-bearing test per `.claude/rules/testing.md`
- [ ] Existing tests not broken by this change

## AI-PR scrutiny checklist (REQ-12-07)

> Applied automatically by `ai-pr-label` when ≥ 80% of diff lines are AI-authored.
> Human reviewers: please verify each item below.

- [ ] **Architecture compliance** — change follows module boundaries in `.claude/CLAUDE.md`; no forbidden cross-module imports (`lib/domain/**` ↛ `next/*`; `app/**` ↛ bare `db`; no direct LLM SDK imports outside `lib/ai/**`)
- [ ] **Edge cases** — error paths and boundary conditions are handled; no silent swallows (`catch (e) {}`)
- [ ] **Silent regressions** — no behavior changed in a neighboring module without a corresponding test update

## Migration / safety checklist

- [ ] No new migration in this PR (skip remaining items)
- [ ] New migration is additive only (nullable columns, new tables with RLS)
- [ ] **OR** migration contains a destructive op (`DROP`, `ALTER … TYPE`, `NOT NULL` backfill) and the `safety:reviewed` label is applied
- [ ] RLS `ENABLE + FORCE + policy` added for every new tenant-scoped table
- [ ] Down migration (`*.down.sql`) is included and tested against a Neon preview branch
- [ ] Rollback strategy documented in this PR description

## AI features checklist (only if `lib/ai/**` changed)

- [ ] All LLM calls go through `lib/ai/gateway.ts` only (no direct `openai`/`anthropic` imports)
- [ ] `assertAiBudget(tenantId, estimateUsd)` called before every LLM call
- [ ] Prompt file version bumped and `changed_in` field updated
- [ ] Corresponding ADR added under `docs/decisions/`
- [ ] `pnpm eval:gate` passes (or link to passing eval run)

## Deployment notes

<!-- Any manual steps, feature-flag flips, or env-var additions required for this change? -->
