Purpose:
Security and correctness review of recent changes using critic-opus plus automated tooling.

Input:
- `$ARGUMENTS`: Optional — specific files or scope. If empty, reviews all uncommitted changes.

Steps:

1) Determine scope
- If arguments provided, review those files/components.
- If no arguments, use `git diff --name-only` for uncommitted changes.
- If nothing uncommitted, use `git diff HEAD~1 --name-only` for last commit.
- If still empty, inform user there's nothing to review.

2) Load context
- Read relevant specs/plans if they exist for the changes being reviewed.
- Read the changed files.

3) Run automated checks (parallel)
Execute in parallel:
- `uv run ruff check .` (lint)
- `uv run mypy .` (type check)
- `uv run pytest --tb=short` (tests)

4) Spawn critic-opus
Pass changed files and any spec/plan context for review:
- Security, correctness, clean code, performance, architecture compliance
- AI bias awareness (reviewing AI-generated code)
- Issue prioritization: CRITICAL → HIGH → MEDIUM → LOW
- Verdict: APPROVE / REQUEST CHANGES / REJECT

5) Present combined results
- Automated check results (lint, types, tests)
- Critic findings with severity and concrete fixes
- Overall verdict
- If REQUEST CHANGES or REJECT, list specific issues to address
