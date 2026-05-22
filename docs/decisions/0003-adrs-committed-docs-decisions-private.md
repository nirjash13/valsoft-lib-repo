<!-- written-by: writer-haiku | model: haiku -->
# ADR-0003 — ADRs Committed Under docs/decisions/, Other Docs Private

**Date:** 2026-05-21  
**Status:** Accepted  
**Deciders:** Tech lead + AI Engineering Manager

## Context

Stack's `.gitignore` historically ignores the entire `/docs` directory to keep internal analysis, design sketches, and architecture rationale private. This is appropriate for most docs: RADAR analyses, tech-stack trade-off studies, and RCA postmortems are proprietary.

However, **Architecture Decision Records (ADRs)** serve a different purpose: they are the living log of how and why the system is shaped as it is. They are:

1. **Needed for code review** — when a PR changes AI routing or introduces a new pattern, reviewers need to reference the ADR that established it.
2. **Needed for CI gates** — Spec 11 REQ-11-09 requires an ADR entry when a prompt file changes; the CI job must be able to verify the ADR exists.
3. **Needed for hiring and handoff** — a new team member reading the codebase can see why the stack uses Vercel hourly cron, not Workflow DevKit, and why eval gates exist.

Therefore, ADRs must be committed and visible to the CI pipeline, while the rest of `/docs` (analysis, design, postmortems) stays private.

## Decision

Git's ignore pattern is changed from the directory form `/docs` to the contents form `/docs/*` with an exception:

```
# Private docs (analysis, design — not for public repo)
# Exception: docs/decisions/ contains ADRs that are committed and reviewed in CI
/docs/*
!/docs/decisions/
```

This pattern:
- Ignores all immediate children of `/docs/` (e.g., `/docs/analysis/`, `/docs/design/`, `/docs/postmortems/`).
- **Re-includes** the `docs/decisions/` subdirectory, allowing ADR files to be committed.
- Requires that `.gitignore` be checked in (it is).

Every ADR file under `docs/decisions/` must carry the provenance marker `<!-- written-by: writer-haiku | model: haiku -->` as the first line (per `.claude/rules/docs.md`).

## Consequences

### Positive
- **CI can verify ADRs** — the `prompt-lint` job checks that `docs/decisions/XXXX-*.md` files exist for changed prompts.
- **Code reviewers have context** — when reviewing a prompt change, they read the ADR that explains the change rationale.
- **ADRs are durable** — they live in git history and can be audited (who made the decision, when, why).
- **Hiring story is clear** — new team members can read the ADR trail and understand the architecture's evolution.

### Negative
- **`.gitignore` exception requires care** — developers must remember that `/docs/*` is the rule and `!/docs/decisions/` is the exception. Mitigated by a clear comment in the file.
- **ADRs can bikeshed** — if the team disagrees on a decision, the ADR is a record of the disagreement. Mitigated by requiring consensus + code review before merging an ADR PR.
- **Accidental commits possible** — a developer might commit an analysis doc to `docs/decisions/` by mistake. Mitigated by code review + PR naming convention (ADRs are numbered 0000, 0001, ...).

## Alternatives considered

1. **Commit all of `/docs/`** — rejected because analysis and design docs are proprietary and large; would bloat the repo and expose decision-making process.
2. **No ADRs at all** — rejected because Spec 11 REQ-11-09 and the interview narrative require visible decision records.
3. **Separate `architecture/` directory outside `/docs/`** — rejected because it splits the architecture story; ADRs belong with the rest of the design documentation.
4. **ADRs in the main README or wiki** — rejected because it mixes architecture records with high-level docs; ADRs deserve their own stable location.

## References

- `.claude/rules/docs.md` — provenance marker requirements
- Spec 11 REQ-11-09 — prompt changes require ADR entry
- Spec 12 § 9 demo notes — "Open `docs/decisions/` — see ADRs that gated AI prompt changes"
- `.gitignore` — ignore pattern configuration
