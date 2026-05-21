<!-- written-by: writer-haiku | model: haiku -->

# Spec-Driven Workflow — AI Prompts for Any Tool

These prompts enable a spec-driven development workflow using any AI coding assistant. Copy the prompt text, fill in the bracketed placeholders with your content, and paste into your tool of choice.

**Compatible with:** GitHub Copilot Chat, Kilo, Cursor, ChatGPT, Claude.ai, or any AI assistant.

## Workflow Stages and Prompts

| Stage | File | Purpose |
|-------|------|---------|
| 1: Requirements | `01-stage1-requirements-clarification.md` | Structure raw stakeholder notes into user stories, constraints, and clarifying questions |
| 2: Design | (human-only) | Design the solution without AI assistance |
| 3a: Spec Clarification | `02-stage3-spec-clarification.md` | Ask the AI clarifying questions before generating the full spec |
| 3b: Spec Generation | `03-stage3-spec-generation.md` | Generate the approved specification with EARS requirements and BDD scenarios |
| 4a: Implementation | `04-stage4-implementation.md` | Implement the spec using test-driven development (write tests first) |
| 4b: Spec Compliance Review | `05-stage4-review-gate.md` | AI code review to verify the implementation matches the spec |

## Using the Prompts

1. **Copy the prompt** from the relevant file (the text between the triple backticks).
2. **Fill in bracketed placeholders** like `[PASTE YOUR STAKEHOLDER NOTES HERE]` with your actual content.
3. **Paste into your AI tool** — GitHub Copilot Chat, ChatGPT, Claude.ai, Cursor, or any other assistant.
4. **Follow the "What to do with the output" section** in each prompt file for next steps.

**Important:** Do not skip the clarification step in Stage 3. The spec-clarification prompt (02) asks questions that must be answered before generating the full spec (03). Skipping this step leads to vague or incorrect specifications.

## For Claude Code Users

If you are using Claude Code (Anthropic's official CLI), do not use these prompts. Instead, use the specialized slash commands in `.claude/commands/`:

- `/spec-stage1` — Requirements clarification
- `/spec-stage3` — Spec generation  
- `/spec-stage4-implement` — Implementation with TDD
- `/spec-stage4-review` — Spec compliance review

## Templates and Supporting Documents

Completed requirements and design documents should be saved to the parent directory (`../`):

- `requirements-template.md` — Template for Stage 1 output
- `design-notes-template.md` — Template for Stage 2 output
- `[feature-name].spec.md` — Your completed spec (Stage 3 output)

## Workflow Overview

**Stage 1 (AI):** Clarify raw requirements into user stories and constraints.  
**Stage 2 (Human):** Design the solution. No AI.  
**Stage 3 (AI):** Clarify the design, then generate a detailed spec with acceptance criteria.  
**Stage 4 (AI + Human):** Implement with TDD, then run a spec compliance review before opening a PR.

Each stage hands off to the next. Get sign-off before advancing.
