<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 03 — Circulation: Borrow, Return, Holds & Renewals

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies assignment:** *"Mark books as checked in (borrowed) or checked out (returned)."* (Minimum 1.2)
**Architecture refs:** [01 RADAR](../../docs/analysis/01-radar-analysis.md) §5.5 Phase 1 · [04 Data Model](../../docs/analysis/04-multi-tenant-data-model.md) §loans, §holds

---

## 1. What this feature is

The circulation engine: who has which book, when it is due, and what happens next. The brief's minimum is "mark as borrowed / returned." This spec adds **due dates** with per-tenant policy, **renewals** with limit and conflict-with-holds rules, a **holds queue** (waiting list) with deterministic promotion on return, and **per-action audit** rows. All operations are wrapped in a transaction with `SELECT … FOR UPDATE` on the book row so two librarians can never double-loan the same copy.

The assignment phrases this confusingly — "checked in (borrowed) or checked out (returned)" inverts standard library usage. **In UI we use "Borrow" and "Return"; in the data model we use unambiguous timestamps `checked_out_at` and `returned_at`.** This decision is locked.

> **Value beyond the brief.** Borrow/Return → done. We additionally deliver: (a) **policy-driven due dates** per tenant (default 14 days), (b) **renewals** (configurable limit, refused if another member has a hold), (c) **holds queue** with deterministic FIFO promotion + 72-hour pickup window, (d) **per-action audit log**, (e) **`FOR UPDATE` concurrency safety**, and (f) emits domain events (`loan.checked_out`, `loan.returned`, `hold.placed`, `hold.promoted`) that drive notifications (Spec 07).

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **Loan** | One row in `loans` linking a `book_id` and a `member_id`. Active if `returned_at IS NULL`. |
| **Borrow** | UI verb for "create a loan." (Data field: `checked_out_at`.) |
| **Return** | UI verb for "close a loan." (Data field: `returned_at`.) |
| **Due date** | `loans.due_at`. Computed at borrow time from tenant policy. |
| **Renewal** | Extending the due date without returning. Counted in `loans.renewed_count`. |
| **Hold (reservation)** | A row in `holds` representing a member's place in line for a book currently borrowed. |
| **Promotion** | When a hold reaches the front of the queue, it becomes "ready" and the member gets 72 hours to come and borrow. |

## 3. User stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a **librarian**, I need a one-click Borrow flow that scans/selects a book and a member and sets the due date. | Must |
| US-02 | As a **librarian**, I need a one-click Return that records the return and triggers any waiting hold. | Must |
| US-03 | As a **librarian**, I need to renew a loan from the loan detail page, with the system refusing if a hold is waiting. | Must |
| US-04 | As a **member**, I need to place a hold on a borrowed book and see my position in the queue. | Must |
| US-05 | As a **member**, I need an email when my hold is ready to pick up. | Must (see Spec 07) |
| US-06 | As a **tenant admin**, I need to configure loan duration, max renewals, hold pickup window per tenant. | Must |
| US-07 | As a **librarian**, I need to never accidentally double-loan a book even if two of us click Borrow at the same moment. | Must |
| US-08 | As a **librarian**, I need to see overdue loans and members with overdue items. | Should |
| US-09 | As a **member**, I need to see my current loans, due dates, and renewal eligibility. | Must |

## 4. Functional requirements (EARS)

```
REQ-03-01: When a librarian submits the Borrow form with (book_id, member_id), the system shall (a) open a
transaction, (b) `SELECT * FROM books WHERE id=$1 FOR UPDATE`, (c) verify the book has no active loan and is not
soft-deleted, (d) compute `due_at = NOW() + tenant.loan_duration_days`, (e) INSERT one `loans` row, (f) write
`audit_log.action='loan.borrowed'`, (g) emit `loan.checked_out`, (h) commit.

REQ-03-02: When a librarian submits the Return form for an active loan, the system shall (a) open a transaction,
(b) `UPDATE loans SET returned_at=NOW() WHERE id=$1 AND returned_at IS NULL`, (c) if 0 rows updated raise
"already returned", (d) write `audit_log.action='loan.returned'`, (e) emit `loan.returned`, (f) commit.

REQ-03-03: When `loan.returned` is emitted, the system shall check `holds` for the same book ordered by
`queued_at`, take the head row, set `holds.status='ready'` and `holds.ready_until=NOW()+tenant.hold_pickup_hours`,
write `audit_log.action='hold.promoted'`, and emit `hold.promoted`.

REQ-03-04: When a member places a hold on a book that has any active loan, the system shall INSERT one
`holds` row with `status='queued'` and `queued_at=NOW()`, refuse to place a second hold for the same member on
the same book, and return the member's queue position.

REQ-03-05: When a librarian renews a loan, the system shall (a) refuse if `renewed_count >= tenant.max_renewals`,
(b) refuse if any `holds.status IN ('queued','ready')` exists for this book, (c) otherwise set
`due_at = due_at + tenant.loan_duration_days` and `renewed_count = renewed_count + 1`, (d) write
`audit_log.action='loan.renewed'`.

REQ-03-06: While a `holds.status='ready'` row has `ready_until < NOW()`, when the hourly worker runs, the system
shall mark it `status='expired'` and promote the next queued hold (recursive promotion until none queued or
promoted hold is fresh).

REQ-03-07: When a member opens "My loans", the system shall return active loans with `due_at`, `renewed_count`,
`max_renewals`, and a boolean `can_renew` reflecting hold conflicts and renewal-limit checks.

REQ-03-08: While a loan's `due_at < NOW()` AND `returned_at IS NULL`, when any read of the loan happens, the
system shall flag it `is_overdue=true` and (Spec 07) drive the overdue email workflow.

REQ-03-09: When `tenant.loan_duration_days`, `max_renewals`, or `hold_pickup_hours` changes, the system shall
apply the new value to **future** borrows/holds only — existing loans/holds retain their original computed values.

REQ-03-10: When a librarian or admin reads any circulation list, the system shall enforce CASL `can('read',
'loan')` and `can('read','hold')` (members see only their own; librarians see all in tenant).
```

## 5. Acceptance scenarios (BDD)

### REQ-03-01 — happy borrow
- **Given** Book B is in the catalog, has no active loan, and Member M exists
- **When** Librarian L submits Borrow(B, M) at 2026-06-01 10:00 UTC with `loan_duration_days=14`
- **Then** a `loans` row exists with `checked_out_at=2026-06-01T10:00Z, due_at=2026-06-15T10:00Z, returned_at=NULL`
- **And** the `audit_log` shows one `loan.borrowed` row tagged with L's `actor_id`.

### REQ-03-01 — double-loan refused
- **Given** Book B has an active loan
- **When** two librarians simultaneously click Borrow(B, M1) and Borrow(B, M2)
- **Then** exactly one transaction commits; the other receives 409 Conflict "book is currently borrowed"
- **And** `FOR UPDATE` was the serialization point (verified by `pg_stat_activity` trace in integration test).

### REQ-03-02 — return promotes hold
- **Given** Book B is on loan to M1 and M2, M3 are queued holds in that order
- **When** Librarian L submits Return(B)
- **Then** the loan closes, `holds(M2).status` becomes `ready` with `ready_until` 72 h ahead
- **And** an email is queued to M2 (verified via Spec 07 fixture).

### REQ-03-05 — renewal refused due to hold
- **Given** Loan L1 has `renewed_count=0` and another member has a queued hold on the same book
- **When** Librarian clicks Renew(L1)
- **Then** the system refuses with "Cannot renew — another member is waiting"
- **And** no DB update occurs.

### REQ-03-05 — renewal refused due to limit
- **Given** `tenant.max_renewals=2` and `loans.renewed_count=2`
- **When** Renew is clicked
- **Then** refuse with "Renewal limit reached".

### REQ-03-06 — expired hold promoted to next
- **Given** Hold H1 became `ready` 73 hours ago (never picked up) and H2 is queued
- **When** the hourly worker runs at hour 73
- **Then** H1 becomes `expired`, H2 becomes `ready`, audit rows written for both.

### REQ-03-09 — policy change isolation
- **Given** tenant changes `loan_duration_days` from 14 to 21
- **When** an existing loan with `due_at=2026-06-15` is re-read
- **Then** its `due_at` is still 2026-06-15 (not recomputed)
- **And** the next new borrow uses 21.

## 6. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-03-01 | Borrow/Return commit fast | While DB is healthy, when Borrow/Return commits, the round-trip shall complete within 250 ms p95. | 250 ms p95 |
| NFR-03-02 | Concurrency proof | When the integration test simulates 50 concurrent Borrow(B) requests, exactly 1 shall succeed. | Integration test gate |
| NFR-03-03 | Hold promotion is exactly-once | When the worker promotes a hold, the system shall use a `SELECT … FOR UPDATE SKIP LOCKED` so a duplicate worker run does not double-promote. | Worker idempotency test |
| NFR-03-04 | Time math is timezone-safe | All timestamps stored as UTC; UI renders in tenant timezone (default America/Montreal — Valsoft HQ; configurable). | Verified by snapshot tests |

## 7. Edge cases

- Borrow of a soft-deleted book → refused with "Book has been withdrawn."
- Borrow by a `members.status='pending'` member (signup not yet approved — see Spec 04) → refused.
- Return at the exact `due_at` second → not overdue (boundary is strictly `>`).
- Member with an unpaid late fee (out of scope v1) — flag as `can_borrow=false` via Spec 04 hook.
- Renewal of a loan whose book has been soft-deleted while loaned → allow renewal so the borrower can return on time, then catalog repair takes over.
- Worker clock skew vs DB clock → workers use `NOW()` in the SQL transaction, never client clock.

## 8. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-03-01 | Late fees in v1? | [NON-BLOCKING] — recommend defer to v2 |
| Q-03-02 | Self-Borrow (member borrows themselves without librarian) — v1 or v2? | [NON-BLOCKING] — v2 |
| Q-03-03 | Multiple copies of the same title (FRBR-ish) — model as separate `books` rows in v1? | [NON-BLOCKING] — yes; multi-copy with shared bibliographic record is v2 |

## 9. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **Librarian reviewer (workflow):** ___________
- [ ] Date approved: ___________
