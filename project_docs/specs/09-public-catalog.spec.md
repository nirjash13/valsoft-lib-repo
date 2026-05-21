<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 09 — Public Catalog: Per-Tenant Read-Only Browse Page

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies assignment:** Creativity (Bonus 3.5).
**Architecture refs:** [01 RADAR](../../docs/analysis/01-radar-analysis.md) §5.5 Phase 3 · Spec 01 (auth boundary) · Spec 05 (search)

---

## 1. What this feature is

Every Stack tenant gets a **public, read-only catalog URL** — for example `acme.stack.app/browse` — that any visitor can open without logging in. They can search, filter, view book detail pages, and see availability. They cannot place holds, borrow, or chat with Reader's Advisor; those require a signed-in member account.

The page is **Incremental Static Regeneration (ISR)** cached at the edge, so it costs almost nothing to serve and tolerates spikes (a local newspaper linking to the library) without scaling concerns.

> **Value beyond the brief.** Not asked. We deliver: (a) a **marketing surface** that lets a library show off its collection, (b) **a way for prospective members to evaluate the library before signing up**, (c) **SEO-friendly book pages** so a library's catalog can be discoverable via Google, (d) zero per-view AI cost (lexical search only on the public surface — Spec 05 REQ-05-10), (e) a cheap acquisition funnel — every page has a "Get a library card" CTA tied to Spec 04's signup flow.

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **ISR** | Incremental Static Regeneration — Next.js feature that pre-renders pages, revalidates on a schedule or on demand. |
| **Public catalog** | The read-only browse surface under `<tenant>.stack.app/browse` (and `/browse/[bookId]`). |
| **Availability badge** | A green/amber chip on a book card: "Available", "On loan — due Mar 5", "X holds queued". |
| **OG image** | The Open Graph image used when a URL is shared on social/messaging. Per-book, generated at build. |

## 3. User stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a **prospective member**, I need to browse the library's catalog without making an account so I can decide if it has what I want. | Must |
| US-02 | As a **prospective member**, I need to search the public catalog by title/author/subject. | Must |
| US-03 | As a **prospective member**, I need a clear "Get a library card" CTA on every page that leads to the signup form (Spec 04). | Must |
| US-04 | As a **member sharing a book link with a friend**, I need the link to open cleanly on the friend's phone, with a nice preview when shared in iMessage/WhatsApp. | Should |
| US-05 | As a **tenant admin**, I need to toggle the public catalog on or off per tenant. | Must |
| US-06 | As a **tenant admin**, I need an option to hide certain subjects from the public catalog (e.g., staff-only collections). | Could |
| US-07 | As a **prospective member**, I need to be sure the public catalog never leaks staff data, loan history, or member info. | Must |
| US-08 | As a **search engine**, I need server-side rendered HTML and a sitemap. | Must |

## 4. Functional requirements (EARS)

```
REQ-09-01: When a request arrives at `/browse` or `/browse/[bookId]` without a session, the system shall render
the public catalog page using ISR with `revalidate=60`; no auth redirect occurs.

REQ-09-02: When the public catalog page renders, the system shall query a tenant-scoped reporting view
(`reporting.public_books`) that contains only non-deleted, non-restricted books with safe fields (title, authors,
year, subjects, language, cover_url, description, availability), and no fields about members, loans, or holds
beyond aggregate counts.

REQ-09-03: When a visitor searches on the public catalog, the system shall use **lexical-only** search (Spec 05
REQ-05-10); the search request shall not invoke any LLM or embedding API.

REQ-09-04: When a visitor opens a book detail page, the system shall render server-side with a per-book OG
image generated at build (Next.js `opengraph-image.tsx`) showing cover + title + library name.

REQ-09-05: When a tenant admin toggles `tenants.public_catalog_enabled=false`, the system shall (a) return 404
for `<tenant>.stack.app/browse*`, (b) remove the tenant from the global sitemap, (c) invalidate edge cache.

REQ-09-06: While `tenants.public_catalog_subject_blocklist` contains a subject, when a book has any blocked
subject, the public catalog query shall exclude it (defense-in-depth: applied in the view AND in the
application filter).

REQ-09-07: When a book is added, updated, or soft-deleted, the system shall trigger on-demand revalidation of
the matching public catalog pages via Next.js `revalidatePath`.

REQ-09-08: When the public catalog renders, every interactive control that requires authentication (Borrow,
Place Hold, Ask Stack) shall be a link to `/login?return_to=...` not a button-with-action — no client code should
attempt a privileged action.

REQ-09-09: When the sitemap is requested at `/sitemap.xml`, the system shall include every public book URL for
tenants where `public_catalog_enabled=true`, with lastmod set to `updated_at`.

REQ-09-10: When traffic to the public catalog exceeds 100 RPS for any single tenant, the system shall serve
exclusively from edge cache for the next 5 minutes (origin shielded) and emit a metric.
```

## 5. Acceptance scenarios (BDD)

### REQ-09-01 — visitor browses without login
- **Given** an unauthenticated visitor opens `acme.stack.app/browse`
- **When** the response arrives
- **Then** the page renders within 500 ms (cached)
- **And** no `Set-Cookie` for a session is set.

### REQ-09-02 — no PII on public page
- **Given** the public catalog renders
- **When** a security tester inspects the HTML / API responses
- **Then** no member name, loan record, hold record, or audit row is present
- **And** the visible availability label is aggregate: "On loan — due 2026-06-15" or "3 holds queued" (no member names).

### REQ-09-04 — OG image renders
- **Given** the URL `acme.stack.app/browse/<book-id>`
- **When** Slack/iMessage unfurls the link
- **Then** the preview shows the cover, title, author, library name
- **And** the image URL responds 200 within 1 s.

### REQ-09-05 — disable removes from public
- **Given** Tenant Admin disables public catalog
- **When** any visitor opens `/browse`
- **Then** they get 404
- **And** `/sitemap.xml` no longer contains acme URLs.

### REQ-09-06 — blocked subject hidden
- **Given** subject "Staff Reference" is in the blocklist
- **When** any visitor searches "reference"
- **Then** "Staff Reference" books do not appear
- **And** logged-in librarians still see them via Spec 05 internal search.

### REQ-09-08 — Borrow is a link not a button
- **Given** an unauthenticated visitor on `/browse/<book-id>`
- **When** they click "Borrow"
- **Then** they are taken to `/login?return_to=/browse/<book-id>` (or signup CTA)
- **And** no API request attempting Borrow is sent.

## 6. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-09-01 | Public catalog is fast | TTFB ≤ 100 ms p95 from edge (cached). | 100 ms p95 |
| NFR-09-02 | Public catalog has zero LLM cost | When public search runs, no LLM or embedding API call shall occur. | Verified by Langfuse trace inspection in CI |
| NFR-09-03 | Catalog is accessible | Public catalog meets WCAG 2.2 AA (axe-core CI gate). | axe-core pass |
| NFR-09-04 | SEO crawlable | Each book detail page renders title, description, cover URL in HTML (not behind hydration). | Lighthouse SEO ≥ 95 |
| NFR-09-05 | Cache invalidation is timely | Edit/delete/restore actions invalidate the public page within 30 s. | 30 s |

## 7. Edge cases

- Tenant has zero books → public page shows a friendly empty state with a Sign-Up CTA, not an error.
- Tenant is in trial and public_catalog_enabled is undefined → default OFF (opt-in only).
- A book is soft-deleted while a visitor is mid-view → ISR cache may show it for ≤ 60 s; that's acceptable for a public surface and the Borrow link goes to login anyway.
- Visitor visits via custom domain `library.example.com` (out of v1 scope) → only `<tenant>.stack.app` in v1.
- Bot traffic from low-reputation IPs → Cloudflare WAF rules in front; rate-limit at edge.

## 8. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-09-01 | Custom domains per tenant — v1 or v2? | [NON-BLOCKING] — v2 |
| Q-09-02 | Public RSS feed of new arrivals per tenant? | [NON-BLOCKING] — yes; trivial and SEO-friendly |
| Q-09-03 | Allow librarians to mark certain books "do not show publicly" individually (not subject-wide)? | [NON-BLOCKING] — yes via `books.is_public=false` flag |

## 9. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **Security reviewer (no PII on public surface):** ___________
- [ ] **SEO/marketing:** ___________
- [ ] Date approved: ___________
