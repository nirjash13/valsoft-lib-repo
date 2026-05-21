<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 07 — Notifications: Overdue, Hold-Ready, Welcome (with AI-Drafted Patron Emails)

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies assignment:** Creativity (Bonus 3.5) + AI features (Bonus 3.4).
**Architecture refs:** [01 RADAR](../../docs/analysis/01-radar-analysis.md) §5.5 Phase 3 · [02 AI Features](../../docs/analysis/02-ai-features-research.md) §Tier 2 #6 · Spec 03 (events)

---

## 1. What this feature is

The asynchronous workflow layer that turns circulation events into emails: due-date reminders (T-2, T-0, T+1 day), hold-ready notifications, welcome emails on signup approval, and rejection emails. The transactional engine is **Resend + React Email**. The differentiator is the **AI-draft mode**: a librarian opens "Compose batch reminder for overdue loans" and the assistant drafts personalized emails in the tenant's brand voice; the librarian reviews and clicks Send.

Durable, retryable scheduling runs on **Vercel Workflow DevKit** (GA April 2026, per `03-tech-stack-decisions.md`).

> **Value beyond the brief.** No notifications were requested. We deliver: (a) **three transactional flows** that close the loop on the circulation engine, (b) **AI-drafted batch communications** that respect a per-tenant brand voice, (c) **librarian review** before any patron-bound email is sent (no auto-AI-send), (d) durable workflows that survive deploy and platform restart, (e) per-tenant rate limiting and PII redaction in logs.

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **Transactional email** | An email triggered by a specific user action (signup approval, hold ready). Sent immediately. |
| **Lifecycle email** | An email scheduled in advance (T-2 days, due today, T+1 days overdue). Sent by a workflow. |
| **React Email** | A library for writing emails as React components — same templating + design tokens as the app. |
| **Resend** | The email provider. Free tier 3,000 emails / month / domain. |
| **Workflow** | A durable, retryable execution unit defined via Vercel Workflow DevKit. Survives deploys. |
| **Brand voice** | Per-tenant configuration (warm/formal/academic) that the AI draft mode uses to set tone. |
| **AI-draft mode** | A composer where the librarian provides an audience filter and intent; the model produces a draft; the librarian edits and sends. |

## 3. User stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a **member**, I need an email 2 days before my book is due so I don't forget. | Must |
| US-02 | As a **member**, I need an email when my held book is ready so I know to come collect it within the pickup window. | Must |
| US-03 | As a **member**, I need a welcome email when my signup is approved with my library card number. | Must |
| US-04 | As a **librarian**, I need to compose a batch email to all members with overdue books, optionally AI-drafted, before sending. | Should |
| US-05 | As a **librarian**, I need to never send an AI-drafted email without reviewing it first. | Must |
| US-06 | As a **tenant admin**, I need a brand-voice setting that the AI draft mode respects (warm/formal/academic). | Should |
| US-07 | As a **tenant admin**, I need to see email delivery success/failure and per-tenant volume to monitor reputation. | Should |
| US-08 | As a **member**, I need an unsubscribe link on lifecycle emails (not on transactional ones legally tied to my account). | Must |

## 4. Functional requirements (EARS)

```
REQ-07-01: When `loan.checked_out` is emitted (Spec 03 REQ-03-01), the system shall schedule a Vercel Workflow
that fires at `due_at - 48h`, `due_at`, and `due_at + 24h` (if not yet returned); each tick sends the
corresponding email and cancels future ticks on `loan.returned`.

REQ-07-02: When `hold.promoted` is emitted (Spec 03 REQ-03-03), the system shall send the "Your hold is ready"
email within 60 seconds, including the pickup window (`ready_until`).

REQ-07-03: When `member.approved` is emitted (Spec 04 REQ-04-04), the system shall send the welcome email within
60 seconds, including the library's address and a link to the catalog.

REQ-07-04: When `member.rejected` is emitted (Spec 04 REQ-04-05), the system shall send the rejection email
within 60 seconds with the rejection reason verbatim.

REQ-07-05: When a librarian opens "Compose batch reminder" and selects an audience filter (overdue >7 days, due
this week, holds ready, etc.), the system shall (a) fetch the audience preview, (b) optionally invoke the
AI-draft endpoint with intent + tenant brand_voice, (c) render the draft for review with subject + body, (d)
require an explicit "Send" click to dispatch.

REQ-07-06: When the AI draft is generated, the system shall use `generateObject` with the `PatronEmailDraft`
Zod schema { subject: string(1..120), body_markdown: string(1..4000), required_fields: { has_book_title: bool,
has_due_date: bool, has_pickup_window: bool } } so structured output is enforceable.

REQ-07-07: When a librarian sends a batch email, the system shall (a) chunk into batches of 50 to respect
Resend rate limit, (b) personalize subject + body per recipient via mustache-style interpolation, (c) write
one `outgoing_emails` row per send with `delivery_status='queued'`, (d) handle webhook callbacks from Resend
to update status.

REQ-07-08: When an email send fails with a 5xx, the system shall retry up to 3 times with exponential backoff;
on permanent failure (bounce, complaint), the system shall flag the recipient `email_status='bouncing'` and
suppress future sends to that address.

REQ-07-09: While a member has `notification_prefs.lifecycle_emails=false`, when a lifecycle workflow fires,
the system shall skip that send (transactional sends — signup welcome, hold-ready — still go).

REQ-07-10: When any email is sent, the system shall log a Langfuse span (for AI-drafted) tagged with tenant,
audience size, and cost; the recipient identity is hashed in logs (PII redaction).
```

## 5. Acceptance scenarios (BDD)

### REQ-07-01 — due-soon reminder
- **Given** Member borrows Book on 2026-06-01 with `due_at=2026-06-15`
- **When** the workflow ticks on 2026-06-13 (T-2)
- **Then** Member receives "Your book is due in 2 days" with book title and due date
- **And** if Member returns the book on 2026-06-14, the T-0 and T+1 ticks are cancelled.

### REQ-07-02 — hold ready
- **Given** Hold is promoted via Spec 03
- **When** the event handler runs
- **Then** within 60 s Member receives "Your hold for `<title>` is ready — please pick up by 2026-06-18 14:00."

### REQ-07-05 — AI draft, librarian review
- **Given** Librarian selects audience "members with books overdue 5+ days" (12 members)
- **When** they click "AI draft"
- **Then** a draft appears with subject "Friendly reminder: your library books" and a body that includes a `{{book_title}}` and `{{due_date}}` interpolation
- **And** the librarian edits the closing salutation and clicks Send
- **And** the system dispatches 12 personalized emails in batches of 50 (one batch).

### REQ-07-06 — draft missing required field
- **Given** the AI draft returns body lacking `{{due_date}}`
- **When** the system validates against `PatronEmailDraft.required_fields`
- **Then** the validator flags it; the draft cannot be sent until the librarian inserts the missing token
- **And** the UI shows "Add a due date — patrons need this".

### REQ-07-08 — bounce suppression
- **Given** Resend webhook reports a permanent bounce for `j.doe@example.com`
- **When** the webhook handler runs
- **Then** `members.email_status='bouncing'` and no further sends are attempted
- **And** the librarian sees a banner "1 member has a bouncing address — needs update."

### REQ-07-09 — lifecycle opt-out honored
- **Given** Member has set `notification_prefs.lifecycle_emails=false`
- **When** the T-2 workflow tick runs
- **Then** no email is sent; an `outgoing_emails` row is written with `delivery_status='skipped_opt_out'`.

## 6. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-07-01 | Transactional emails are fast | Welcome/hold-ready emails sent within 60 s of triggering event. | 60 s |
| NFR-07-02 | Workflow durability | When the platform restarts mid-workflow, the workflow shall resume from the last completed step. | Verified by chaos test |
| NFR-07-03 | Email cost is bounded | The per-tenant per-month email volume cap (default 5,000) shall be enforced before send; over-cap → admin alert + soft block. | Cap enforced |
| NFR-07-04 | Templates render in all major clients | React Email templates shall be tested against Gmail, Outlook, Apple Mail, Yahoo via the Email-checker preview suite. | CI snapshot |
| NFR-07-05 | PII not leaked to LLM | The AI-draft endpoint shall send audience *aggregates and book titles*, never per-recipient PII (names are interpolated at send time, not at draft time). | Verified by integration test |
| NFR-07-06 | Unsubscribe instant | Lifecycle unsubscribe link sets `notification_prefs.lifecycle_emails=false` and shows a confirmation page within 2 s. | 2 s |

## 7. Edge cases

- Member's email was changed mid-workflow → workflow uses the address at send time, not at schedule time.
- Loan returned at the exact instant the T-0 workflow ticks → race resolved by re-checking `returned_at IS NULL` inside the workflow step; skip if already returned.
- Tenant brand_voice = "academic" but the audience is teen members — librarian sees a "tone mismatch?" hint before sending.
- Two librarians simultaneously open "Compose batch" — independent drafts; not collaborative; first-Sender wins; second is told "audience changed since draft."
- Bounce webhook arrives before the send is logged (race) — handler retries until the matching `outgoing_emails` row exists.
- A scheduled workflow that fires after the loan/hold/member is soft-deleted — workflow detects and exits with `outgoing_emails.delivery_status='skipped_subject_removed'`.

## 8. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-07-01 | SMS in v1? | [NON-BLOCKING] — v2 (Twilio integration) |
| Q-07-02 | Per-locale templates (FR/EN at minimum given Montreal/Valsoft)? | [NON-BLOCKING] — start with EN, add FR in Phase 4 if time |
| Q-07-03 | Should AI-draft also support social-media posts (newsletter / event)? | [NON-BLOCKING] — out of scope v1 |
| Q-07-04 | Cap on AI-drafted emails per librarian per day (anti-abuse)? | [NON-BLOCKING] — recommend 20/day default |

## 9. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **AI reviewer (PII gate):** ___________
- [ ] **Librarian reviewer:** ___________
- [ ] Date approved: ___________
