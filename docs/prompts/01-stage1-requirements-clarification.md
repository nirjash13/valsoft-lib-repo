<!-- written-by: writer-haiku | model: haiku -->

# Stage 1 — Requirements Clarification Prompt

**Description:** Use this prompt when you have raw stakeholder notes, a meeting transcript, or an informal feature request. The AI will structure them into user stories, surface ambiguities, and list questions to take back to stakeholders — before any design work begins.

**Works with:** GitHub Copilot Chat, Kilo, Cursor, ChatGPT, Claude.ai, or any AI assistant.

## Inputs to gather first

- Raw stakeholder notes, meeting notes, or feature request (copied as text)
- Name of the feature (for output naming)

## The Prompt

```
You are helping a software engineering team clarify and structure requirements before design begins.

I will share raw stakeholder notes or a feature request below. Your job is to analyze, structure, and surface gaps — not to propose a technical solution.

Produce the following five sections:

1. PROBLEM RESTATEMENT
Write a 2–3 sentence problem statement in plain language.
Format: "Currently, [state of the world]. This causes [pain]. We need [capability] so that [business outcome]."

2. STRUCTURED USER STORIES
For every distinct need in the notes, write a user story:
Format: "As a [role], I need [capability] so that [business value]."
Do not propose solutions. Describe needs only.
If a role is unstated, infer from context or mark [role: TBD].

3. CONSTRAINTS IDENTIFIED
List all constraints stated or implied:
- Performance (latency targets, throughput)
- Security and compliance (audit trail, GDPR, SOC 2)
- Technical ("cannot change the existing API")
- Budget or timeline

4. CLARIFYING QUESTIONS
For every ambiguity or missing detail, write a specific question.
Format: "Q: [The question]. Context: [Why this matters — what decision depends on this answer]."
Mark each: [BLOCKING] (must be answered before design begins) or [NON-BLOCKING].
Be specific: "Does 'access' mean view, download, or both?" — not "What do you mean by access?"

5. ASSUMED NEEDS
Requirements likely needed but not explicitly mentioned. Mark each [ASSUMED NEEDED] with one sentence explaining why.
Do not add scope — surface risks for the Product Owner to confirm or deny.

--- Raw stakeholder notes below ---
[PASTE YOUR STAKEHOLDER NOTES OR FEATURE REQUEST HERE]
```

## What to do with the output

- Copy the output into `project_docs/spec-driven/requirements-template.md` (fill in the template)
- Take the BLOCKING questions back to the Product Owner or stakeholders for answers
- Get Product Owner sign-off on the requirements before Stage 2 begins
- Stage 2 is human-only design — do not use AI until Stage 3
