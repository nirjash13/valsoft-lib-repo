# User Story Generator — Usage Guide
<!-- version: 1.0 | author: Safkat Nirjash -->

## What This Is

A prompt that turns plain-language requirements into professional, project-management-ready Scrum user stories — with user journey, description, technical insights, and full acceptance criteria (functional + non-functional).

The prompt lives in **`user-story-prompt.md`**. This file explains how to use it.

---

## Setup by Platform

### Claude (claude.ai)
1. Start a new conversation
2. Click **System prompt** (or use a Project with instructions)
3. Paste the full contents of `user-story-prompt.md`
4. Send your requirement as a normal message

### ChatGPT
**Option A — Custom GPT:**
1. Go to **Explore GPTs → Create**
2. In the **Instructions** field, paste `user-story-prompt.md`
3. Save and use it anytime

**Option B — System prompt via API:**
```json
{ "role": "system", "content": "<contents of user-story-prompt.md>" }
```

### Google Gemini
1. Open **Gemini Advanced**
2. Use **Gems** → Create a new Gem
3. Paste `user-story-prompt.md` into the instructions field

### GitHub Copilot Chat
Prepend the prompt to your first message in the chat window. Copilot does not support persistent system prompts in the standard editor experience.

### Any OpenAI-compatible API
```python
messages = [
    {"role": "system", "content": open("user-story-prompt.md").read()},
    {"role": "user", "content": your_requirement}
]
```

---

## How to Write Your Requirement Message

### Minimum (works fine)
```
I want org admins to be able to invite members via CSV bulk upload.
```

### With context (produces sharper output)
Paste your requirement, then add a `---` separator and include any relevant context below it.

```
I want org admins to be able to invite members via CSV bulk upload, 
with a preview step before sending invitations.

---

## Context

**Roles in our system:** super_admin, org_admin, member
**Tech stack:** FastAPI + PostgreSQL + Celery + React
**Existing modules:**
- app/services/user_service.py — handles user creation and invitation emails
- app/repositories/org_repository.py — org membership queries
- alembic/versions/0085_notifications.py — notification schema already exists

**Related story:** Members can be invited one at a time via email (already shipped)

**Constraint:** CSV max 500 rows. Larger uploads should be rejected with a clear error.
```

---

## What Context to Include

| Context type | Why it helps |
|---|---|
| Role/actor names | Keeps story actors consistent with your system |
| Tech stack | Technical Insights reference real patterns |
| Existing module names or file paths | Dependencies section names real modules |
| Related stories already done | Avoids duplicate scope, improves Dependencies |
| Constraints or limits | Surfaces as Acceptance Criteria, not assumptions |
| Architecture notes or ERDs | Informs data model hints in Technical Insights |
| Other user stories (paste them in) | Calibrates story point estimate and scope |

---

## Customizing the Prompt for Your Team

Add these lines at the end of `user-story-prompt.md` to lock in team-specific conventions:

```
## TEAM OVERRIDES
- Role names: super_admin, org_admin, member (use exactly these, no paraphrasing)
- Story point scale: Fibonacci (1, 2, 3, 5, 8, 13, 21)
- Project management tool: ClickUp — use ClickUp-compatible Markdown
- Tech stack: FastAPI + PostgreSQL + Redis + Celery + React
- Epic list: Authentication & Access, Evaluation Pipeline, Model Routing, Billing & Subscriptions, Admin & Platform
```

---

## Example Output Structure

Every generated story follows this structure:

```
### Story Title
### Epic
### Labels
### User Journey
### Description
### Technical Insights (High Level)
### Acceptance Criteria
  #### Functional    (min 8 items)
  #### Non-Functional (min 5 items)
### Out of Scope (This Story)
### Story Points Estimate
### Dependencies
```

Total acceptance criteria: ≥ 13 items guaranteed.

---

## Tips

- **Be specific about the primary actor** — "super admin" vs "admin" produces different stories
- **Name exclusions explicitly** — "not including billing" → goes into Out of Scope, not Acceptance Criteria
- **Paste real code or schemas** — the prompt reads them and uses real names instead of invented ones
- **Include a related story** — helps the model calibrate scope and avoid re-covering shipped work
