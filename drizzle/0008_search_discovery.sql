-- =============================================================================
-- Migration: 0008_search_discovery
-- Description: Hybrid search infrastructure — tsvector GENERATED column,
--              trigram indexes, book_embeddings table (pgvector HNSW),
--              and search_zero_result_log table.
-- Spec:        05 — Search & Discovery (Hybrid Lexical + Semantic)
--
-- SAFETY LABEL REQUIRED: This migration adds a GENERATED ALWAYS column to the
-- books table (tsv tsvector GENERATED ALWAYS AS (...) STORED). On large tables
-- this rewrites every row in the table to populate the generated value.
-- Per .claude/rules/migrations.md §Per-PR safety, this requires the
-- `safety:reviewed` PR label before merging. For tenant catalogs up to 50k
-- books this is acceptable downtime in a maintenance window.
-- Merge is blocked by CI until the `safety:reviewed` label is applied.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions (idempotent)
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- books — add tsvector GENERATED column + trigram + GIN indexes
-- ---------------------------------------------------------------------------

-- Weighted tsvector builder — wrapped in an IMMUTABLE SQL function.
-- Weight mapping per REQ-05-02:
--   A = title (highest)
--   B = authors
--   C = subjects
--   D = description (lowest)
--
-- Why the wrapper: `to_tsvector('english', …)` is only STABLE, not IMMUTABLE,
-- because resolving the `'english'` text literal to a `regconfig` performs a
-- catalog lookup (regconfigin is STABLE). A GENERATED column requires a strictly
-- IMMUTABLE expression, so Postgres rejects the inlined form
-- ("generation expression is not immutable"). The canonical fix is an IMMUTABLE
-- SQL wrapper: we assert immutability, which holds as long as
-- `default_text_search_config` is not repointed (it never is in this project).
CREATE OR REPLACE FUNCTION books_search_tsv(
  p_title       text,
  p_authors     text[],
  p_subjects    text[],
  p_description text
) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT setweight(to_tsvector('english', coalesce(p_title, '')), 'A') ||
         setweight(to_tsvector('english', coalesce(array_to_string(p_authors, ' '), '')), 'B') ||
         setweight(to_tsvector('english', coalesce(array_to_string(p_subjects, ' '), '')), 'C') ||
         setweight(to_tsvector('english', coalesce(p_description, '')), 'D')
$$;

-- GENERATED ALWAYS AS … STORED: Postgres recomputes the value on INSERT/UPDATE
-- so there is no application-layer indexing step for the tsv column itself.
-- The embedding column (book_embeddings table) still requires an application call.
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS tsv tsvector GENERATED ALWAYS AS (
    books_search_tsv(title, authors, subjects, description)
  ) STORED;

-- GIN index over tsvector (plain GIN; tenant filtering delegated to RLS)
CREATE INDEX IF NOT EXISTS books_tsv_gin
  ON books USING gin (tsv);

-- Trigram index over title for fuzzy typo matching (REQ-05-01 typo tolerance)
CREATE INDEX IF NOT EXISTS books_title_trgm
  ON books USING gin (title gin_trgm_ops);

-- `array_to_string` is only STABLE (it depends on element output functions),
-- so it cannot appear directly in an index expression. Wrap it in an IMMUTABLE
-- SQL function. The lexical-search domain query uses this same function so the
-- planner can match the expression and actually use this index.
CREATE OR REPLACE FUNCTION immutable_array_to_string(arr text[], sep text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT array_to_string(arr, sep)
$$;

-- Trigram index over authors (concatenated) for fuzzy author name search
CREATE INDEX IF NOT EXISTS books_authors_trgm
  ON books USING gin (immutable_array_to_string(authors, ' ') gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- book_embeddings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS book_embeddings (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid         NOT NULL,
  book_id        uuid         NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  embedding      vector(1536) NOT NULL,
  model_version  text         NOT NULL,
  created_at     timestamptz(3) NOT NULL DEFAULT now(),
  updated_at     timestamptz(3) NOT NULL DEFAULT now(),

  -- One embedding row per (tenant, book, model). Allows rolling cutover when
  -- upgrading embedding models (REQ-05-09): old model rows remain until batch
  -- re-embed completes; search queries on the most-rows model version.
  UNIQUE (tenant_id, book_id, model_version)
);

-- Composite tenant-first index (required by migrations.md — every tenant table)
CREATE INDEX IF NOT EXISTS book_embeddings_tenant_book_idx
  ON book_embeddings (tenant_id, book_id);

-- HNSW vector index for approximate-nearest-neighbour cosine search (REQ-05-05)
-- m=16, ef_construction=64 are pgvector defaults — suitable for tenants ≤ 50k books.
-- For larger datasets, increase m + ef_construction and rebuild CONCURRENTLY.
CREATE INDEX IF NOT EXISTS book_embeddings_hnsw_idx
  ON book_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE book_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_embeddings FORCE ROW LEVEL SECURITY;

CREATE POLICY book_embeddings_tenant_isolation ON book_embeddings
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON book_embeddings TO stack_app;

-- ---------------------------------------------------------------------------
-- search_zero_result_log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS search_zero_result_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  query      text        NOT NULL,
  user_id    text,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);

-- Index for the librarian dashboard query (Spec 08): recent zero-result queries
-- per tenant, ordered most-recent first.
CREATE INDEX IF NOT EXISTS search_zero_result_log_tenant_at_idx
  ON search_zero_result_log (tenant_id, created_at DESC);

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE search_zero_result_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_zero_result_log FORCE ROW LEVEL SECURITY;

CREATE POLICY search_zero_result_log_tenant_isolation ON search_zero_result_log
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

GRANT SELECT, INSERT ON search_zero_result_log TO stack_app;
