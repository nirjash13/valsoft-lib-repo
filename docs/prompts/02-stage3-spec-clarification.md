<!-- written-by: writer-haiku | model: haiku -->

# Stage 3 — Spec Clarification Prompt (Step 1 of 2)

**Description:** Run this BEFORE generating the spec. Give the AI your requirements and design notes, and it will ask clarifying questions. Answer them, then use the Spec Generation Prompt (03-stage3-spec-generation.md). Skipping this step leads to vague or incorrect specs.

**Works with:** GitHub Copilot Chat, Kilo, Cursor, ChatGPT, Claude.ai, or any AI assistant.

## Inputs to gather first

- Completed requirements doc (from Stage 1)
- Design notes (from Stage 2 — the completed design-notes-template.md)

## The Prompt

```
I'm sharing requirements and a design sketch for a software feature. Before you generate the spec, I want you to ask clarifying questions.

Read everything below, then:
1. Summarize in 2–3 sentences what you understand we are building and why.
2. List your clarifying questions. For each question:
   - State the question clearly and specifically.
   - Explain what implementation decision depends on the answer.
   - Mark [BLOCKING] if the spec cannot be written without this answer.
   - Mark [NON-BLOCKING] if you can make a reasonable assumption and note it.

Do not generate the spec yet. Wait for my answers.

--- Requirements ---
[PASTE YOUR REQUIREMENTS DOC HERE]

--- Design Notes ---
[PASTE YOUR DESIGN NOTES HERE]
```

## What to do with the output

- Answer each BLOCKING question (escalate to tech lead or PO if you don't know)
- Note your answers — you'll include them in the Spec Generation Prompt next
- Use `03-stage3-spec-generation.md` for the next step
