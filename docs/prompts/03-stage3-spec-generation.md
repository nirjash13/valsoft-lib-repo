<!-- written-by: writer-haiku | model: haiku -->

# Stage 3 — Spec Generation Prompt (Step 2 of 2)

**Description:** Use this after completing the clarification step. Provide requirements, design notes, your answers to the AI's clarifying questions, and optional codebase context. The AI will produce a complete `.spec.md` file with EARS requirements, BDD acceptance criteria, and a design validation.

**Works with:** GitHub Copilot Chat, Kilo, Cursor, ChatGPT, Claude.ai, or any AI assistant.

## Inputs to gather first

- Completed requirements doc
- Completed design notes
- Answers to the clarifying questions from Stage 3 Step 1
- Optional: brief description of your codebase patterns (e.g., "We use repository pattern, async Python, FastAPI")

## The Prompt

```
Generate a complete specification document for the feature described below.

Use this exact document structure:

# [Feature Name] Specification

## Problem Statement
[2–3 sentences describing the business problem]

## Confirmed Requirements
[Bullet list from the requirements doc]

## Design Overview
[Summary of the design approach with key decisions]

## Functional Requirements (EARS Format)
For each requirement, use this format:
REQ-001: [Title]
While [precondition], when [trigger event], the system shall [action].

Include every distinct behavior the system must perform.

## Non-Functional Requirements
For each non-functional requirement, use this format:
NFR-001: [Category — Performance / Security / Availability / Scalability]
While [precondition], when [trigger], the system shall [action].
Threshold: [measurable value, e.g., "response time < 500ms" or "99.95% uptime"]

## Acceptance Criteria (BDD Format)
For each REQ, write 2–3 scenarios covering: happy path, failure path, and one edge case.
Use this format:
**Scenario [N]: [Title]**
- Given: [precondition]
- When: [action taken]
- Then: [expected result]
- And: [additional assertion if needed]

## Design Validation
Review the design notes I provided. For each design decision, produce one of:
✓ [Decision confirmed] — [one sentence why it is sound]
⚠ [Decision flagged] — [specific concern and recommendation]
△ [Alternative considered] — [alternative approach, pros/cons, and whether to adopt it]

## Edge Cases
Bullet list of non-obvious boundary conditions (null values, concurrent actions, large volumes, legacy records, external service failures).

## Open Questions
Any remaining ambiguities that must be resolved before implementation begins.
Format: "Q: [Question] — Owner: [TBD or name]"

---
**Approved by:**
- Tech Lead: ___________ ✓
- Product Owner: ___________ ✓
- Date: ___________

---

--- Requirements ---
[PASTE YOUR REQUIREMENTS DOC HERE]

--- Design Notes ---
[PASTE YOUR DESIGN NOTES HERE]

--- Clarification Answers ---
[PASTE YOUR ANSWERS TO THE AI'S QUESTIONS FROM STEP 1]

--- Codebase Context (optional) ---
[DESCRIBE YOUR CODEBASE PATTERNS OR PASTE RELEVANT CODE SNIPPETS]
```

## What to do with the output

- Save as `project_docs/spec-driven/[feature-name].spec.md`
- Review with tech lead — iterate with feedback until the spec is accurate
- Get sign-off from both Tech Lead and Product Owner before Stage 4
- Do not begin implementation without sign-off
