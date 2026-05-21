<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 04 — Member Management: Roles, Pre-Seeded Demo Accounts & Self-Signup Approval

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies assignment:** *"Different user roles and permissions"* (Bonus 3.3) — extended per user request 2026-05-21 to include pre-seeded admin accounts and self-signup with librarian approval.
**Architecture refs:** [01 RADAR](../../docs/analysis/01-radar-analysis.md) §4.5 · [04 Data Model](../../docs/analysis/04-multi-tenant-data-model.md) §members · Spec [01](./01-foundation-multi-tenancy-auth.spec.md)

---

## 1. What this feature is

The role hierarchy of Stack, the people who fill those roles, and the path a new patron takes from "I found this library's signup page" to "I can borrow my first book."

The brief asks for SSO and roles. This spec extends that minimum with two interlocking choices the user made explicit in `05-requirements-traceability.md` §8 (2026-05-21):

1. **Pre-seeded role-typed accounts** in the demo tenant — `owner@stack.demo`, `admin@library.demo`, `librarian@library.demo`, `member@library.demo` — so a reviewer can log into each role in one click and experience the product from each viewpoint.
2. **Member self-signup with librarian approval** — the public landing page of each tenant has a "Get a library card" link. The form creates a `members.status='pending'` row. A librarian sees it in an Approvals queue, approves or rejects. On approval, a welcome email goes out and the account becomes usable.

> **Value beyond the brief.** Self-signup + approval queue **makes the demo interactive** (the reviewer can hit the public form themselves, then switch to librarian to approve). Pre-seeded role accounts **let the reviewer evaluate every role without configuration**. Both choices are deliberate UX decisions tuned to the assignment context.

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **Role** | A named bundle of permissions: System Owner, Tenant Admin, Librarian, Member, Guest. |
| **System Owner** | Cross-tenant operator. Provisions new tenants, sees platform-wide metrics, never reads tenant business data without explicit operator-mode escalation. |
| **Tenant Admin** | The library's owner. Configures the tenant (loan policy, hold pickup window, brand voice), invites staff, manages billing (out of v1 scope). |
| **Librarian** | Front-desk staff. Manages catalog, runs Borrow/Return/Holds, approves member signups, sends communications. |
| **Member** | Library patron. Borrows, places holds, chats with Reader's Advisor, sees own loan history. |
| **Guest** | Unauthenticated viewer of the public catalog (Spec 09). |
| **Pending** | A `members` row with `status='pending'` — created via signup form, not yet approved. Cannot borrow. |
| **Approval queue** | Librarian view listing all `status='pending'` members with one-click Approve / Reject. |

## 3. Role × Permission matrix

| Capability | System Owner | Tenant Admin | Librarian | Member | Guest |
|------------|:-:|:-:|:-:|:-:|:-:|
| View public catalog | ✓ | ✓ | ✓ | ✓ | ✓ |
| Browse catalog (logged-in) | ✓ | ✓ | ✓ | ✓ | — |
| Borrow / return | — | — | ✓ | — | — |
| Self-renew own loan | — | — | — | ✓ | — |
| Place / cancel own hold | — | — | ✓ (on member's behalf) | ✓ | — |
| Add / edit / remove books | — | ✓ | ✓ | — | — |
| Approve / reject signup | — | ✓ | ✓ | — | — |
| Invite staff | — | ✓ | — | — | — |
| Edit tenant settings | — | ✓ | — | — | — |
| Read audit log | — | ✓ | ✓ | — | — |
| Send patron communications | — | ✓ | ✓ | — | — |
| Reader's Advisor chat | — | ✓ | ✓ | ✓ | — |
| Reports — operational | — | ✓ | ✓ (read) | — | — |
| Reports — financial / billing | — | ✓ | — | — | — |
| Provision new tenant | ✓ | — | — | — | — |

Permissions compile to CASL rules of the form `can('action', 'subject', conditions?)`. See `lib/auth/abilities.ts` in implementation.

## 4. User stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a **reviewer**, I need a published login card with each pre-seeded role so that I can experience the product from each viewpoint without configuration. | Must |
| US-02 | As a **prospective member**, I need to sign up at the library's public page and receive an email once I'm approved. | Must |
| US-03 | As a **librarian**, I need an Approvals queue showing pending signups with name, email, sign-up date, and one-click Approve / Reject. | Must |
| US-04 | As a **librarian**, I need to reject with a reason so that the system emails the requester a polite explanation. | Should |
| US-05 | As a **tenant admin**, I need to invite a librarian by email and have them sign in via SSO. | Must |
| US-06 | As a **tenant admin**, I need to deactivate a former librarian's account so their access stops immediately. | Must |
| US-07 | As a **member**, I need to update my profile (name, contact, notification prefs) so my account reflects reality. | Should |
| US-08 | As a **system owner**, I need to provision a new tenant in one form so that onboarding a new library is fast. | Must (see Spec 01 REQ-01-09) |
| US-09 | As a **member with a pending signup**, I need a friendly waiting page that explains the status, with an option to log out. | Should |

## 5. Functional requirements (EARS)

```
REQ-04-01: When the deploy seed script runs against the demo tenant, the system shall create exactly four pre-seeded
accounts — owner@stack.demo (System Owner), admin@library.demo (Tenant Admin), librarian@library.demo (Librarian),
member@library.demo (Member) — and surface the credentials on the login page of the demo tenant under a "Demo
accounts" disclosure.

REQ-04-02: When a prospective member submits the public signup form (name, email, agreeing to tenant terms), the
system shall (a) verify CAPTCHA, (b) verify email is not already a member of this tenant, (c) INSERT one
`members` row with `status='pending'` and `tenant_id` resolved from hostname, (d) write audit_log.action=
'member.signup_requested', (e) email the librarian queue, (f) email the requester an acknowledgment.

REQ-04-03: When a librarian opens the Approvals queue, the system shall list all `status='pending'` members in
order of `created_at`, with name, email, days-since-signup, and Approve / Reject buttons.

REQ-04-04: When a librarian approves a pending signup, the system shall (a) set `status='active'`, (b) send the
Auth0 Organization invitation, (c) write `audit_log.action='member.approved'`, (d) trigger the welcome email
(Spec 07).

REQ-04-05: When a librarian rejects a pending signup with a reason, the system shall (a) set `status='rejected'`,
`rejection_reason`, (b) write audit, (c) email the requester the rejection with the reason; the row is retained
for 90 days then anonymized.

REQ-04-06: When a tenant admin invites a staff member by email and role, the system shall send an Auth0
Organization invitation, persist a pending invitation row, and surface the status in the staff list until
accepted, expired, or revoked.

REQ-04-07: When a tenant admin deactivates a staff or member account, the system shall (a) set `status='inactive'`,
(b) revoke the Auth0 session via the Management API, (c) refuse all of the user's API requests with 403, (d)
audit.

REQ-04-08: While a member's `status='pending'`, when they attempt any authenticated action other than viewing
their profile and the public catalog, the system shall refuse with the "Awaiting approval" friendly page.

REQ-04-09: When a member updates their profile (name, contact, notification prefs), the system shall validate
inputs against the `MemberProfile` Zod schema, persist, and audit.

REQ-04-10: While a tenant has more than 100 pending signups older than 7 days, when an admin loads the dashboard,
the system shall show a warning banner urging triage.
```

## 6. Acceptance scenarios (BDD)

### REQ-04-01 — demo accounts available
- **Given** the demo tenant is freshly seeded
- **When** a reviewer visits `https://demo.stack.app/login`
- **Then** the page lists four demo accounts under a "Try a role" disclosure
- **And** clicking each takes the user through Auth0 sign-in with that account's email pre-filled.

### REQ-04-02 — signup happy path
- **Given** an unauthenticated visitor on `acme.stack.app/signup`
- **When** they submit name + email + agree-terms with valid CAPTCHA
- **Then** within 1 s the page shows "Thanks — your library will email you when approved"
- **And** a `members` row exists with `status='pending'` and tenant_id=acme
- **And** the librarian queue increments by 1.

### REQ-04-02 — duplicate signup
- **Given** the same email already has any `members` row for tenant acme
- **When** the signup form submits
- **Then** the response is "This email already has an account at this library — try signing in" (no detail about status, to avoid enumeration).

### REQ-04-04 — approval flow
- **Given** a Librarian on the Approvals queue
- **When** they click Approve next to a pending row
- **Then** the row transitions to `status='active'`, an Auth0 Organization invitation email is sent, the audit log records `member.approved`, and the welcome email is queued (Spec 07).

### REQ-04-05 — rejection with reason
- **Given** a Librarian rejects with reason "Outside service area"
- **When** they submit
- **Then** the row is `status='rejected'` with `rejection_reason` stored
- **And** an email to the requester reads: "We're sorry — your application was not approved. Reason: Outside service area."

### REQ-04-07 — deactivation cuts off access immediately
- **Given** Librarian L has an active session
- **When** the Tenant Admin deactivates L's account
- **Then** L's next API request returns 403 within the next session-refresh window (≤60 s)
- **And** the Auth0 session is invalidated via Management API.

### REQ-04-08 — pending member tries to borrow
- **Given** a member with `status='pending'` logs in
- **When** they navigate to a book detail page and click Borrow
- **Then** the page renders the "Awaiting approval" UI explaining status
- **And** no Borrow API call is allowed (CASL `can('borrow','loan')` is false).

## 7. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-04-01 | Approvals queue is current | While pending approvals exist, the queue shall reflect changes within 5 s of mutation. | 5 s eventual consistency |
| NFR-04-02 | Signup is bot-resistant | When the form is rendered, the system shall include hCaptcha and a honeypot field; submissions with either failing shall be rejected silently. | Verified by integration test |
| NFR-04-03 | Demo accounts are visibly demo-only | When the demo tenant login renders, the four demo emails shall be labelled as such; on non-demo tenants the disclosure shall not appear. | Snapshot test |
| NFR-04-04 | Pending data has retention bound | While a `members` row is `status='rejected'` for >90 days, the daily worker shall anonymize the email and personal fields. | 90-day retention enforced |
| NFR-04-05 | Auth0 invitation deliverability | Email-from header uses tenant's verified domain when configured; otherwise the platform default with a `Reply-To` header to the tenant. | Verified in integration tests |

## 8. Edge cases

- Multiple signups from the same email at different tenants — independent rows; both allowed.
- A rejected signup re-applies — allowed once per 30 days per tenant; rate-limited.
- Tenant admin tries to demote themselves to Librarian — refused if they would be the last admin.
- Librarian approves while another librarian rejects in the same second — last-write-wins; both audit rows kept; UI re-fetches to show the actual outcome.
- A `status='rejected'` member tries to sign up again the next day — see rate-limit above; UI shows "Already applied recently — please contact the library."
- Demo account passwords/credentials in seed must not appear in production seed; CI check verifies env gating.

## 9. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-04-01 | Self-renewal by member (US-09 in §3) — v1 or v2? | [NON-BLOCKING] — recommend v1 once trusted |
| Q-04-02 | Notification preferences granularity in v1 (email-only vs SMS) | [NON-BLOCKING] — v1 email only |
| Q-04-03 | hCaptcha vs Cloudflare Turnstile? | [NON-BLOCKING] — recommend Turnstile (free, no PII to a 3rd party) |
| Q-04-04 | Per-tenant signup form fields (some libraries want address/phone) — configurable v1 or fixed schema? | [NON-BLOCKING] — fixed v1, configurable v2 |

## 10. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **Librarian reviewer:** ___________
- [ ] Date approved: ___________
