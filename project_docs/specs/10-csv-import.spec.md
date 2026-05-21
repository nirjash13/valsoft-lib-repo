<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 10 — CSV Import: Bulk Catalog Onboarding with Batch Enrichment

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies assignment:** Creativity (Bonus 3.5).
**Architecture refs:** Spec 02 (book schema + enrichment) · Spec 07 (notifications) · Spec 11 (cost cap)

---

## 1. What this feature is

Most real libraries onboard from a spreadsheet. A librarian uploads a CSV; Stack streams it, validates row-by-row, enriches each ISBN against Open Library + Google Books (Spec 02), and writes books in batches. The import is **resumable**: if a row fails, the import doesn't abort; an error report is produced and the librarian can re-upload only the failed rows.

> **Value beyond the brief.** Not asked. We deliver: (a) realistic **library onboarding** (libraries don't manually enter 1,000 books), (b) **streaming parse** (any CSV size, bounded memory), (c) **per-row enrichment** with caching to amortize cost, (d) **error report download** so partial failures are recoverable, (e) **rate-limited** to stay within tenant AI cap (Spec 11).

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **Import job** | One CSV upload, tracked in `import_jobs` (status, totals, owner). |
| **Row** | One book candidate from the CSV. Has its own status: `pending`, `enriched`, `inserted`, `failed`. |
| **Enrichment** | The ISBN-fan-out (Spec 02) applied per row. |
| **Dry run** | An import that validates and previews but does not write. |
| **Error report** | A downloadable CSV listing failed rows with reasons; same column shape as input plus an `error` column for easy re-upload. |

## 3. Supported CSV columns

The librarian uploads a CSV with one or more of: `isbn13`, `title`, `authors` (semicolon-separated), `year`, `publisher`, `page_count`, `subjects` (semicolon-separated), `language`, `description`. **The minimum requirement is** `isbn13` **or both** `title` **and at least one author**.

## 4. User stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a **librarian**, I need to upload a CSV and see Stack import it without me babysitting. | Must |
| US-02 | As a **librarian**, I need a dry-run preview before any data is written. | Should |
| US-03 | As a **librarian**, I need to download an error report when some rows fail so I can fix and re-upload only those rows. | Must |
| US-04 | As a **librarian**, I need import progress visible — "230 of 1,000 imported" — so I know it's working. | Should |
| US-05 | As a **librarian**, I need duplicate ISBNs in the file deduplicated, and duplicates that already exist in my catalog flagged. | Must |
| US-06 | As a **tenant admin**, I need import to respect the monthly AI cap — if it would exceed, the import pauses. | Must |
| US-07 | As a **librarian**, I need a notification when import finishes (or fails) so I can move on. | Should |
| US-08 | As a **librarian**, I need to cancel a running import. | Should |

## 5. Functional requirements (EARS)

```
REQ-10-01: When a librarian uploads a CSV (≤ 50 MB or ≤ 50,000 rows, whichever is reached first), the system
shall stream-parse it, create one `import_jobs` row with `status='running', total_rows=N`, and begin processing
rows in chunks of 25.

REQ-10-02: When a row has an ISBN, the system shall invoke the Spec 02 enrichment with cache (per-tenant
`isbn_cache`); CSV-provided fields take precedence over enriched fields where both are non-empty.

REQ-10-03: When a row lacks ISBN but has title + author, the system shall write the book directly (no enrichment)
and flag `enrichment_skipped=true` so the librarian can enrich later.

REQ-10-04: When a row fails validation (missing required field, bad year, malformed ISBN-13 checksum), the system
shall record it in `import_rows` with `status='failed'` and `error_reason`, and continue with the next row.

REQ-10-05: When the librarian chose "dry run", the system shall produce the same row-level result without
inserting `books`; it shall still consume enrichment cache (so the live run is fast).

REQ-10-06: When a row's ISBN matches an existing non-deleted `books` row in this tenant, the system shall flag
`status='duplicate'` with the existing `book_id`; the librarian can choose to skip or merge from the import UI.

REQ-10-07: When the running enrichment cost (sum of LLM + embedding cost across this job + month-to-date)
projects to exceed the tenant AI cap, the system shall pause the job at the next safe checkpoint with
`status='paused_quota'` and notify the librarian.

REQ-10-08: When the import completes, the system shall (a) set `status='completed'`, (b) generate the error
report CSV, (c) send the librarian an email (Spec 07) with summary and download link, (d) emit `book.created`
events in trickled batches so the search indexer is not overwhelmed.

REQ-10-09: When a librarian cancels a running import, the system shall stop processing new rows, mark
`status='cancelled'`, retain already-imported rows (no rollback), and offer a "Cleanup imported rows" action
that soft-deletes the rows from this job.

REQ-10-10: When the same CSV row would create or trigger a 4xx three times in a row (transient enrichment 5xx),
the system shall record the row as failed with `error_reason='enrichment_unavailable'` and continue; the
librarian can retry just the failed rows.
```

## 6. Acceptance scenarios (BDD)

### REQ-10-01 — happy 1,000-row import
- **Given** a 1,000-row CSV with valid ISBNs
- **When** Librarian uploads
- **Then** within 3 minutes the job reaches `status='completed'`
- **And** 1,000 books are added (or merged) into the tenant catalog
- **And** the error report is empty.

### REQ-10-04 — partial failure produces error report
- **Given** 950 valid rows and 50 with malformed ISBN-13
- **When** the job runs
- **Then** 950 books are inserted, 50 rows are `status='failed'`
- **And** the downloadable error CSV contains exactly 50 rows + an `error` column with reasons.

### REQ-10-05 — dry run does not write
- **Given** Librarian clicks Dry Run on the same 1,000-row CSV
- **When** the job completes
- **Then** the `books` table is unchanged
- **And** the dry-run summary mirrors what a live run would produce
- **And** subsequent live run finishes faster because `isbn_cache` is warm.

### REQ-10-06 — duplicates flagged
- **Given** 100 of the rows have ISBNs already in the catalog
- **When** the job runs
- **Then** the duplicates are not inserted; instead `import_rows` show `status='duplicate'` with `existing_book_id`
- **And** the UI shows a "100 duplicates — review and merge / skip" panel.

### REQ-10-07 — cap pause
- **Given** Tenant is at 90% AI cap and the import would exceed
- **When** the job runs
- **Then** the job pauses at the safe checkpoint with banner "AI quota would be exceeded — raise cap or wait until next cycle"
- **And** already-enriched rows are preserved; the librarian can resume after raising the cap.

### REQ-10-08 — finish notification
- **Given** a completed import
- **When** the worker finalizes
- **Then** an email is queued via Spec 07 with summary (X inserted, Y duplicates, Z failed) and download link.

## 7. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-10-01 | Import is streaming | When processing, memory usage shall stay below 256 MB regardless of file size up to the limit. | Verified by load test |
| NFR-10-02 | Throughput is sufficient | Sustained throughput ≥ 5 rows/sec including enrichment at 50% cache hit rate. | 5 rows/s sustained |
| NFR-10-03 | Resumable on platform restart | When the platform restarts mid-import, the job shall resume at the last committed chunk via Vercel Workflow. | Verified by chaos test |
| NFR-10-04 | Error report is faithful | The error CSV shall be re-uploadable as-is (after fixes) and produce a new job with only those rows. | Verified by round-trip test |
| NFR-10-05 | Cost predictability | Median per-row enrichment cost shall be ≤ $0.002 with cache; ≤ $0.005 without. | Cost tested in eval |

## 8. Edge cases

- CSV with BOM, Windows line endings, Mac line endings — all supported.
- CSV with quoted fields containing commas or newlines — RFC 4180 compliant parser.
- Extremely long fields (description > 4000 chars) — truncate with notice in error report.
- Mixed character encodings — assume UTF-8; reject with friendly error if invalid bytes detected.
- 50,001st row → rejected with "File too large — please split (<50,000 rows per file)."
- All-empty CSV → job completes with 0 rows; error report empty; UI shows "Nothing to import."
- Two librarians upload the same CSV at the same time → two independent jobs; duplicates handled per REQ-10-06.

## 9. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-10-01 | Should we support XLSX too? | [NON-BLOCKING] — CSV only v1 |
| Q-10-02 | Should we support MARC21 / MARCXML import? | [NON-BLOCKING] — v2; not v1 |
| Q-10-03 | Merge policy on duplicate: replace, skip, or "merge non-empty fields"? | [NON-BLOCKING] — default skip; offer merge as opt-in per-row |

## 10. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **Librarian reviewer:** ___________
- [ ] Date approved: ___________
