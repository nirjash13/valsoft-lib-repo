<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 05 — Search & Discovery: Hybrid Lexical + Semantic + Books-Like-This

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies assignment:** *"Find books by title, author, or other fields."* (Minimum 1.3)
**Architecture refs:** [01 RADAR](../../docs/analysis/01-radar-analysis.md) §5.5 Phase 2 · [02 AI Features](../../docs/analysis/02-ai-features-research.md) §1, §5 · [03 Tech Stack](../../docs/analysis/03-tech-stack-decisions.md) §Search

---

## 1. What this feature is

The single search box of a Stack catalog. Users type — anything from `"jane eyre"` to `"books about grief written by a parent"` — and get results in one ranked list. Behind the seam:

1. **Lexical search** — Postgres `tsvector` GIN index on `title || authors || description || subjects`. Catches typos with trigram fuzziness, ranks with `ts_rank_cd`.
2. **Semantic search** — OpenAI `text-embedding-3-small` (1536-d) stored in pgvector with an HNSW index. Catches intent.
3. **Hybrid fusion** — Reciprocal Rank Fusion (RRF) in a single CTE merges the two result lists. The user never sees the seam.
4. **Books like this** — on a book detail page, a vector-neighbours query returns 6 visually distinct, semantically similar titles.
5. **Faceting + filters** — subject, language, availability, year-range. Computed from the result set.

> **Value beyond the brief.** "Find by title, author, or other fields" → a `LIKE` query. We deliver a **production hybrid search engine** with a measurable eval set (`nDCG@5 ≥ 0.65`), faceting, and a related-items surface — the entire discovery layer of a modern catalog.

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **tsvector** | Postgres's full-text representation of a document; supports stemming, weights, and ranking. |
| **GIN index** | Generalized Inverted Index — Postgres's index type for tsvector and JSONB. |
| **trigram** | A 3-character window of a string. Used for typo-tolerant matching via `pg_trgm`. |
| **Embedding** | A 1536-d float vector that places semantically similar text near each other in vector space. |
| **HNSW** | Hierarchical Navigable Small World — the ANN index type pgvector recommends for >10k vectors. |
| **RRF** | Reciprocal Rank Fusion — `score = Σ 1/(k + rank_i)` across systems. Combines ranked lists without normalizing scores. |
| **nDCG@5** | Normalized Discounted Cumulative Gain at 5 — the standard IR metric for "is the right answer near the top?" |
| **Facet** | A filter dimension computed from the result set (e.g., 5 subjects appear in the top 50 results — present them as checkboxes). |

## 3. User stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a **member**, I need to find a book by typing part of its title or author, even if I misspell it. | Must |
| US-02 | As a **member**, I need to describe what I want in plain language ("cozy mystery set in Iceland") and get on-topic results. | Must |
| US-03 | As a **member**, I need to narrow results by availability, subject, language, or year so that I can find an actual book I can borrow today. | Should |
| US-04 | As a **member**, I need search to feel instant. | Must |
| US-05 | As a **member**, I need a "books like this" panel on every book detail page so that I can discover more. | Should |
| US-06 | As a **librarian**, I need a "0 results" report so I see what patrons are looking for that we don't carry. | Should |
| US-07 | As a **librarian**, I need to never see another library's books in any result. | Must (Spec 01) |
| US-08 | As a **member**, I need search to never show me books that were soft-deleted. | Must (Spec 02) |

## 4. Functional requirements (EARS)

```
REQ-05-01: When a member submits a search query, the system shall run the lexical query (tsvector + trigram
fallback) and the semantic query (pgvector HNSW over query embedding) and combine results via RRF with k=60
(canonical RRF constant), returning at most 50 books ranked by RRF score.

REQ-05-02: When the system computes RRF, the lexical ranker shall weight `tsvector` heavier than trigram fallback,
and the semantic ranker shall require a cosine similarity ≥ 0.30 before contributing rank.

REQ-05-03: When a book is created or its searchable fields change (Spec 02 REQ-02-03 / 02-04), the indexing
worker shall (a) recompute `tsv` column (via stored procedure), (b) embed the searchable text, (c) UPSERT the
embedding into `book_embeddings` with the model name + version, (d) complete within 5 s p95.

REQ-05-04: While `books.deleted_at IS NOT NULL`, when search runs, the system shall exclude that row entirely
(query-level filter, not post-process).

REQ-05-05: When a member opens a book detail page, the system shall query the 6 nearest neighbours by cosine
similarity (excluding the source book and soft-deleted), and render them in a "Books like this" rail.

REQ-05-06: When search returns >0 results, the system shall compute facet counts for `subjects`, `language`,
`availability` (in stock / on loan), and `year_bucket` (decade), and return them alongside the result list.

REQ-05-07: When a facet is selected, the system shall apply it as a SQL WHERE clause on the candidate set before
RRF (faceted candidates only).

REQ-05-08: When the query returns 0 results, the system shall (a) log a `search_zero_result` event with the
query text, (b) suggest the closest 3 catalog titles via embedding cosine to the query, and (c) offer a
"Suggest we add this" CTA.

REQ-05-09: When the embedding model is upgraded, the system shall keep the old model column populated until a
batch re-embed completes; queries shall always embed with the model named in `book_embeddings.model_version`
that has the most rows (rolling cutover).

REQ-05-10: While a member is unauthenticated and on the public catalog (Spec 09), when they search, the system
shall serve cached lexical-only results (no semantic) to keep cost predictable.
```

## 5. Acceptance scenarios (BDD)

### REQ-05-01 — exact title lookup
- **Given** a tenant catalog contains "Jane Eyre" by Charlotte Brontë
- **When** a member searches `jane eyre`
- **Then** "Jane Eyre" is rank 1
- **And** the response time is < 200 ms p95.

### REQ-05-01 — typo tolerance
- **Given** the same catalog
- **When** the member searches `jaen eyer`
- **Then** "Jane Eyre" is rank 1 via trigram fuzzy match
- **And** the response includes a "Did you mean jane eyre?" hint.

### REQ-05-02 — semantic intent
- **Given** the catalog contains "The Sun Also Rises", "A Moveable Feast", and "For Whom the Bell Tolls"
- **When** a member searches `hemingway novels set in europe`
- **Then** all three appear in the top 10 even though "hemingway" appears in none of the titles (it appears in the authors field, and "set in europe" is semantic)
- **And** "The Sun Also Rises" outranks unrelated Hemingway non-fiction.

### REQ-05-04 — soft-deleted excluded
- **Given** "Frankenstein" was soft-deleted
- **When** any search runs
- **Then** "Frankenstein" does not appear
- **And** the Trash view still lists it (Spec 02).

### REQ-05-05 — books like this
- **Given** a member viewing "The Sun Also Rises"
- **When** the page renders
- **Then** the right rail lists 6 books semantically related (Hemingway novels + lost-generation contemporaries)
- **And** none of the 6 are the source book or soft-deleted.

### REQ-05-06 — facets reflect result set
- **Given** a search returns 80 books
- **When** facets are computed
- **Then** the subject list shows top 8 subjects by count
- **And** clicking "Fiction" reduces results to fiction-only and re-computes facets.

### REQ-05-08 — zero results
- **Given** a tenant with no medieval-history books
- **When** the member searches `medieval history`
- **Then** the UI says "No results. Did you mean these?" and lists the 3 nearest semantic matches
- **And** a `search_zero_result` row is logged for the librarian dashboard (Spec 08).

### REQ-05-10 — public-catalog mode is lexical-only
- **Given** an unauthenticated visitor on the public catalog
- **When** they search
- **Then** the request hits the lexical-only ISR cache and does not invoke an embedding API call.

## 6. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-05-01 | Search is fast | When DB is healthy, search response shall be ≤ 250 ms p95 for tenants ≤ 50k books. | 250 ms p95 |
| NFR-05-02 | Search is reasonably correct | When the eval suite runs (`pnpm eval:search`), `nDCG@5 ≥ 0.65` on the curated eval set of 30 queries per fixture tenant. | nDCG@5 ≥ 0.65 (CI gate) |
| NFR-05-03 | Indexing is timely | When a book is added or updated, the new state shall appear in search within 5 s p95. | 5 s p95 |
| NFR-05-04 | Embedding cost is capped | Per-tenant embedding spend per month shall be enforced via Spec 11 cost gate. | Spec 11 cap |
| NFR-05-05 | Search is tenant-isolated | When a cross-tenant probe query runs in CI, no row from another tenant shall appear. | CI gate |

## 7. Edge cases

- Queries with only stopwords ("the", "a") → lexical returns nothing meaningful; semantic still ranks; combined output is fine.
- Mixed-language catalog (French + English in one tenant) — embedder is language-agnostic; tsvector configured to `simple` dictionary so accents are preserved.
- 1-character query → return cached "popular this week" with a "keep typing…" hint.
- Pagination — cursor-based (RRF score + book_id tiebreaker).
- A book with no `description` and no `subjects` — embed `title + authors` only; flag for librarian to enrich.
- Embedding model deprecation — Spec 11 covers; this spec assumes a rolling cutover via `model_version`.

## 8. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-05-01 | Should "Books like this" include other formats (audio, large-print) when we add format in v2? | [NON-BLOCKING] — v2 |
| Q-05-02 | Search-as-you-type debounce — 200 ms or 300 ms? | [NON-BLOCKING] — recommend 250 ms |
| Q-05-03 | Highlight matched fragments in result snippets? | [NON-BLOCKING] — yes, via `ts_headline`, but truncated |
| Q-05-04 | Should we ship `pg_trgm` index alongside tsvector for fuzzy author names? | [NON-BLOCKING] — yes |

## 9. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **AI reviewer (eval set):** ___________
- [ ] Date approved: ___________
