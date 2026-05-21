<!-- written-by: writer-haiku | model: haiku -->

# Stage 4 — Implementation Prompt

**Description:** Use this prompt when you're ready to implement an approved spec. The AI will follow test-driven development: write a failing test for each BDD scenario first, then implement code to make it pass. Paste the full spec and describe your codebase patterns.

**Works with:** GitHub Copilot Chat, Kilo, Cursor, ChatGPT, Claude.ai, or any AI assistant with file/code context.

## Inputs to gather first

- Approved `.spec.md` file (Tech Lead and PO signed off)
- Brief description of your codebase patterns (file structure, framework, async style)
- Optional: 20–50 lines of analogous existing code to use as a style reference

## The Prompt

```
You are helping me implement a software feature using test-driven development (TDD). I will provide the approved specification below.

Rules you must follow:
1. Implement only what is in the spec. Do not add features not required.
2. For every BDD acceptance scenario, write the TEST first (it must fail before you write code), then write the minimum code to make it pass.
3. Every NFR with a measurable threshold (e.g., "response time < 500ms") must be asserted in a test or enforced in code.
4. If anything in the spec is ambiguous, ask me — do not guess.
5. Follow the codebase patterns I describe below.

BEFORE writing any code:
- List every BDD scenario from the spec.
- For each scenario, state what test you will write and what it will assert.
- Wait for my confirmation before starting implementation.

--- Spec ---
[PASTE YOUR FULL SPEC FILE CONTENT HERE]

--- Codebase Patterns ---
[DESCRIBE YOUR CODEBASE: framework, patterns, folder structure, async style.
Example: "We use FastAPI with async SQLAlchemy. Repositories in /repositories/, services in /services/, endpoints in /api/v1/. All functions are async. Use pytest with pytest-asyncio for tests."]

--- Existing Code Reference (optional) ---
[PASTE 20–50 LINES OF ANALOGOUS EXISTING CODE HERE]
```

## What to do with the output

- Review the list of tests before approving — confirm every BDD scenario is covered
- Run tests as they are written — each must fail (RED) before implementation
- After implementation, run the full test suite to confirm no regressions
- Run the spec compliance review next (05-stage4-review-gate.md) before opening a PR
