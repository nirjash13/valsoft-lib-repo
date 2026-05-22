-- =============================================================================
-- Migration: 0016_csv_import
-- Description: Create import_jobs and import_rows tables with RLS, indexes,
--              and assert_tenant() isolation policies.
-- Spec:        10 — CSV Import
-- =============================================================================

-- ---------------------------------------------------------------------------
-- REQ-10-03: enrichment_skipped column on books
-- ---------------------------------------------------------------------------

ALTER TABLE books ADD COLUMN IF NOT EXISTS enrichment_skipped boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN books.enrichment_skipped IS 'True when the book was imported without an ISBN (no enrichment applied). Librarian can enrich later.';

-- ---------------------------------------------------------------------------
-- import_jobs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS import_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  status          varchar(30) NOT NULL, -- 'running', 'completed', 'failed', 'paused_quota', 'cancelled'
  total_rows      integer NOT NULL DEFAULT 0,
  processed_rows  integer NOT NULL DEFAULT 0,
  dry_run         boolean NOT NULL DEFAULT false,
  error_count     integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_jobs_tenant_id_idx ON import_jobs (tenant_id, id);

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY import_jobs_tenant_isolation ON import_jobs
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

-- ---------------------------------------------------------------------------
-- import_rows
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS import_rows (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id             uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_index          integer NOT NULL,
  status             varchar(20) NOT NULL, -- 'pending', 'imported', 'failed', 'duplicate', 'skipped', 'merged'
  isbn13             varchar(13),
  title              varchar(300),
  authors            text[],
  year               integer,
  publisher          varchar(200),
  page_count         integer,
  subjects           text[],
  language           varchar(10),
  description        varchar(4000),
  error_reason       text,
  existing_book_id   uuid REFERENCES books(id) ON DELETE SET NULL,
  enrichment_skipped boolean NOT NULL DEFAULT false,
  raw_data           jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_rows_tenant_id_idx ON import_rows (tenant_id, id);
CREATE INDEX IF NOT EXISTS import_rows_tenant_job_idx ON import_rows (tenant_id, job_id, row_index);

ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows FORCE ROW LEVEL SECURITY;

CREATE POLICY import_rows_tenant_isolation ON import_rows
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

-- ---------------------------------------------------------------------------
-- stack_app grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON import_jobs TO stack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON import_rows TO stack_app;
