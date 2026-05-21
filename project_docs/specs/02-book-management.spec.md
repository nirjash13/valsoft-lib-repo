<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 02 — Book Management (CRUD + ISBN Enrichment + Soft-Delete)

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies assignment:** *"Add, edit, and delete books (title, author + whatever metadata you see fit)."* (Minimum 1.1)
**Architecture refs:** [01 RADAR](../../docs/analysis/01-radar-analysis.md) §5.5 Phase 1 · [04 Data Model](../../docs/analysis/04-multi-tenant-data-model.md) §books

---

## 1. What this feature is

Librarians need to add, edit, and remove books from their catalog. The brief says "title, author + whatever metadata you see fit." This spec defines a rich book record (ISBN-13, year, publisher, page count, subjects, language, cover URL, description, custom fields), and — most importantly — an **add-by-ISBN** flow that turns a 13-digit number into a fully populated, cover-art-enclosed record in under three seconds via Open Library + Google Books, with LLM-normalized blurb.

Books are **never hard-deleted** because `loans` and `audit_log` reference them; instead, `books.deleted_at` is set and the row hides from searches. A Trash admin view restores within retention.

> **Value beyond the brief.** "Add, edit, delete" → CRUD. We deliver CRUD **plus**: (a) **one-paste ISBN-to-record enrichment** with multi-source agreement and a `BookRecord` Zod schema produced via `generateObject`, (b) **soft-delete + Trash view** for procurement-grade auditability, (c) **per-action audit log** rows, (d) **cover-image proxy + caching** so the demo never shows broken images.

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **ISBN-13** | The 13-digit barcode on the back of every book printed after 2007. |
| **Open Library API** | A free, no-auth-required JSON API by the Internet Archive (`https://openlibrary.org/api/books`). |
| **Google Books API** | A free (rate-limited) JSON API by Google (`https://www.googleapis.com/books/v1`). |
| **`generateObject`** | Vercel AI SDK function that calls an LLM and returns a value conforming to a Zod schema (or throws). |
| **`BookRecord` schema** | The canonical Zod schema for a Stack book record (see §5 REQ-02-02). |
| **Soft-delete** | Marking a row as deleted via `deleted_at IS NOT NULL` instead of removing it. Queries filter it out by default. |
| **Custom fields** | Per-tenant JSONB `custom_fields` for libraries that track room, donor, reading-level, etc. |

## 3. User stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a **librarian**, I need to add a book by pasting its ISBN so that I do not retype every field. | Must |
| US-02 | As a **librarian**, I need to override any auto-filled field before saving so that I can correct enrichment mistakes. | Must |
| US-03 | As a **librarian**, I need to edit any field of an existing book so that I can correct catalog errors. | Must |
| US-04 | As a **librarian**, I need to remove a book from the catalog so that withdrawn copies do not appear in searches — without losing loan history. | Must |
| US-05 | As a **tenant admin**, I need to see deleted books in a Trash view and restore one within 30 days so that I can recover from mistakes. | Should |
| US-06 | As a **librarian**, I need cover art to render reliably so that the catalog page does not look broken. | Should |
| US-07 | As a **librarian**, I need to add books that have no ISBN (zines, archives, donations) by typing the fields directly. | Must |
| US-08 | As a **tenant admin**, I need a tenant-wide field schema (custom fields) so that I can record things specific to my library. | Could |

## 4. Functional requirements (EARS)

```
REQ-02-01: When a librarian submits an ISBN to the Add Book form, the system shall (a) validate ISBN-13 checksum,
(b) check the per-tenant `isbn_cache`, (c) on miss fan out to Open Library and Google Books in parallel with a
3-second timeout each, (d) merge results with field-level precedence rules, (e) optionally pass the merged blob
to `generateObject` with the `BookRecord` Zod schema for normalization, and (f) return a preview to the librarian
before any DB write.

REQ-02-02: When the system validates a book record, the system shall enforce the `BookRecord` schema:
  { isbn13: string(13 digits)?, title: string(1..300), authors: string[](>=1, each 1..200),
    year: int(1450..currentYear+1)?, publisher: string(1..200)?, page_count: int(1..10000)?,
    subjects: string[]?, language: ISO639-1?, cover_url: url?, description: string(0..4000)?,
    custom_fields: record<string,string>? }

REQ-02-03: When the librarian confirms the preview, the system shall insert one `books` row with the schema-valid
record, set `tenant_id` from the session, write an `audit_log` row of `action='book.created'`, and emit a
`book.created` domain event for the search-indexer worker.

REQ-02-04: When a librarian edits any field of an existing book, the system shall validate the new state against
`BookRecord`, persist with optimistic concurrency (`updated_at` matches), write an `audit_log` row with diff, and
re-emit a `book.updated` event.

REQ-02-05: When a librarian removes a book, the system shall set `books.deleted_at = NOW()`, write
`audit_log.action='book.soft_deleted'`, and refuse the operation if the book has an active loan
(`returned_at IS NULL`).

REQ-02-06: While `deleted_at IS NOT NULL`, when a query reads books for search, listing, or detail pages, the
system shall filter the row out by default; the Trash view explicitly opts in.

REQ-02-07: When a tenant admin restores a soft-deleted book within the 30-day retention window, the system shall
set `deleted_at = NULL`, write `audit_log.action='book.restored'`, and re-emit `book.updated`.

REQ-02-08: While more than 30 days have passed since `deleted_at`, when the daily purge worker runs, the system
shall **anonymize** (not delete) the catalog row by clearing PII-free fields it owns and keeping the row referenced
by historical loans. (Anonymize-not-delete preserves loan history integrity.)

REQ-02-09: While the cover image URL fails to load, when the catalog UI renders a book, the system shall fall back
to a neutral placeholder and queue a re-fetch via Vercel Image Optimization.

REQ-02-10: While a librarian adds a book without an ISBN, when the form is submitted, the system shall require
title + at least one author and skip enrichment entirely.
```

## 5. Acceptance scenarios (BDD)

### REQ-02-01 — happy ISBN enrichment
- **Given** a librarian pastes `9780132350884` into the Add Book form
- **When** the form submits
- **Then** within 3 s the preview card shows title "Clean Code", author "Robert C. Martin", year 2008, ISBN, cover image, blurb
- **And** the cover image is served via Vercel Image Optimization
- **And** clicking Save persists the row.

### REQ-02-01 — sources disagree
- **Given** Open Library returns year=2008 and Google Books returns year=2009
- **When** the merger runs
- **Then** the preview shows year=2008 (Open Library precedence) with a "Other source: 2009" hint
- **And** the librarian can pick either before saving.

### REQ-02-01 — both sources empty
- **Given** an ISBN that neither source recognizes
- **When** the form submits
- **Then** the preview shows an empty record with the ISBN pre-filled
- **And** a banner reads "We couldn't find this ISBN — please fill the fields and save."

### REQ-02-02 — schema rejection
- **Given** a librarian edits a book and sets `year=1200`
- **When** they save
- **Then** the form shows "Year must be between 1450 and 2027" inline
- **And** no DB write occurs.

### REQ-02-04 — concurrent edit
- **Given** two librarians open the same book, one edits and saves, then the second saves
- **When** the second save arrives with the stale `updated_at`
- **Then** the server returns 409 Conflict and the form shows a "Refresh — the record was updated" banner.

### REQ-02-05 — refuse delete with active loan
- **Given** a book has a loan with `returned_at IS NULL`
- **When** a librarian clicks Remove
- **Then** the system refuses with "Cannot remove — book is currently loaned to Jane Doe."

### REQ-02-06 — search hides soft-deleted
- **Given** a book was soft-deleted yesterday
- **When** any search runs
- **Then** the deleted book does not appear in results
- **And** it appears in the Trash view.

### REQ-02-07 — restore round-trip
- **Given** a book deleted 5 days ago
- **When** a tenant admin clicks Restore
- **Then** `deleted_at=NULL`, an audit row is written, and the book is searchable again immediately.

## 6. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-02-01 | ISBN preview is fast | When a librarian submits an ISBN, the system shall return a preview within 3 s p95 (cached: 200 ms). | 3 s p95 cold, 200 ms cache-hit |
| NFR-02-02 | Enrichment is idempotent | The `isbn_cache` shall guarantee an identical preview within a tenant for the same ISBN within 24 h. | Cache TTL 24 h |
| NFR-02-03 | LLM normalization is optional | When the LLM step times out or errors, the system shall fall back to the merged blob without LLM. | Fallback verified by chaos test (LLM disabled) |
| NFR-02-04 | Cover proxy is cached at edge | When a cover URL is requested, the response shall be served from Vercel Image cache with `s-maxage>=86400`. | Cache-Control verified in PR check |
| NFR-02-05 | Search re-index is bounded | When `book.created`/`book.updated` is emitted, the embedding+tsvector update shall complete within 5 s p95. | 5 s p95 |

## 7. Edge cases

- ISBN-10 input: convert to ISBN-13 before validation.
- Unicode authors and titles (e.g., 村上 春樹): must round-trip correctly through enrichment, DB, and UI.
- Open Library returns a 404 for unknown ISBN; Google Books returns 200 with `totalItems=0` — both must be treated as "not found", not "error."
- Rate limiting on Google Books: cache per-key request budget; on 429, degrade silently to Open Library only.
- Cover image hosted on HTTP (not HTTPS): block; never embed mixed content.
- `custom_fields` keys: lowercased, snake_case, max 32 chars; values max 500 chars.

## 8. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-02-01 | Do we expose Trash to Librarian or only Tenant Admin? | [NON-BLOCKING] — default Tenant Admin only |
| Q-02-02 | LLM blurb rewriting: opt-in per tenant ("brand voice"), opt-in per book, or off by default? | [NON-BLOCKING] — default off; per-tenant opt-in |
| Q-02-03 | Anonymize-not-delete: which fields are anonymized after 30 days? Title and authors must remain for loan-history readability. | [NON-BLOCKING] — recommend keep title/authors, clear cover_url/description/custom_fields |

## 9. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **Librarian reviewer (UX):** ___________
- [ ] Date approved: ___________
