<!-- written-by: writer-haiku | model: haiku -->

# Stage 4 — Spec Compliance Review Prompt

**Description:** Run this AI code review before opening a pull request. Paste the spec and the changed code. The AI will check every BDD scenario has a test, NFRs are enforced, there's no scope creep, and no security issues. It outputs a PR readiness checklist.

**Works with:** GitHub Copilot Chat, Kilo, Cursor, ChatGPT, Claude.ai, or any AI assistant with code context.

## Inputs to gather first

- Approved `.spec.md` file
- All changed files (paste file contents or a `git diff` output)

## The Prompt

```
You are performing a spec compliance review of a software implementation. Verify that the code matches the spec — not just that the code works in isolation.

Review the following six areas and produce a finding for each:

PART A: ACCEPTANCE CRITERIA COVERAGE
For each BDD scenario in the spec:
- Find the corresponding test in the changed code.
- Verify the test actually asserts the Given / When / Then conditions (not just that the code runs without error).
- Report status:
  COVERED — test exists and asserts the right conditions
  PARTIAL — test exists but assertions are incomplete
  MISSING — no test found for this scenario

PART B: NFR COMPLIANCE
For each non-functional requirement with a measurable threshold:
- Is the threshold enforced in code or asserted in a test?
- Report status: ENFORCED | PARTIAL | NOT ENFORCED

PART C: SCOPE COMPLIANCE
Is there any code in the diff that is NOT required by any requirement in the spec?
Flag each instance: [File and line] — [Description of the extra code]
Label each: SCOPE CREEP

PART D: SECURITY CHECK
Review for:
- SQL injection or query injection risk
- User input passed to queries or system calls without validation
- Hardcoded secrets, API keys, or credentials
- New endpoints missing authentication or authorization checks
- Any OWASP Top 10 concerns

PART E: CODE QUALITY
- Are all functions typed? (no untyped parameters or return values)
- Are async operations handled with timeouts and explicit error handling?
- Is error handling explicit? (no silent failures or bare except clauses)

PART F: VERDICT
State one of:
  APPROVED — ready for human PR review
  NEEDS FIXES — list every issue below

For each issue:
[Severity: CRITICAL / HIGH / MEDIUM / LOW] | [Category] | [File:line] | [Issue description] | [Required fix]

Fix all CRITICAL and HIGH issues before opening a PR.

After the verdict, print this PR Readiness Checklist:
PR READINESS CHECKLIST:
- [ ] Every BDD scenario has a COVERED test
- [ ] All CRITICAL and HIGH issues resolved
- [ ] No scope creep (or scope creep approved by tech lead)
- [ ] NFR thresholds enforced in tests or code
- [ ] Spec file linked in PR description
- [ ] Human reviewer assigned
- [ ] CI test suite passes

--- Spec ---
[PASTE YOUR FULL SPEC FILE CONTENT HERE]

--- Changed Code ---
[PASTE GIT DIFF OUTPUT OR FILE CONTENTS OF CHANGED FILES HERE]
```

## What to do with the output

- Fix every CRITICAL and HIGH issue before opening the PR
- Use the PR Readiness Checklist as your PR description checklist
- Link the spec file in the PR description
- Human reviewer should check architectural alignment and unstated assumptions (not re-check what the AI already reviewed)
