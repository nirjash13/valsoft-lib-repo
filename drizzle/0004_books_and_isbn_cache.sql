-- =============================================================================
-- Migration: 0004_books_and_isbn_cache
-- Description: Create books and isbn_cache tables with RLS, composite indexes,
--              and assert_tenant() isolation policies.
-- Spec:        02 — Book Management (CRUD + ISBN Enrichment + Soft-Delete)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- books
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS books (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  isbn13          varchar(13),
  title           varchar(300) NOT NULL,
  authors         text[]       NOT NULL,
  year            integer,
  publisher       varchar(200),
  page_count      integer,
  subjects        text[],
  language        varchar(10),
  cover_url       text,
  description     varchar(4000),
  custom_fields   jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- Composite tenant-first index (required by migrations.md — every tenant table)
CREATE INDEX IF NOT EXISTS books_tenant_id_idx ON books (tenant_id, id);

-- ISBN lookup (per-tenant): helps isbn_cache deduplication + catalog search
CREATE INDEX IF NOT EXISTS books_tenant_isbn13_idx ON books (tenant_id, isbn13)
  WHERE isbn13 IS NOT NULL;

-- Soft-delete filter (per-tenant): listing active books is the hot path
CREATE INDEX IF NOT EXISTS books_tenant_active_idx ON books (tenant_id, id)
  WHERE deleted_at IS NULL;

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE books FORCE ROW LEVEL SECURITY;

CREATE POLICY books_tenant_isolation ON books
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

-- ---------------------------------------------------------------------------
-- isbn_cache
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS isbn_cache (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  isbn13      varchar(13) NOT NULL,
  payload     jsonb       NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Composite tenant-first index (required by migrations.md)
CREATE INDEX IF NOT EXISTS isbn_cache_tenant_id_idx ON isbn_cache (tenant_id, id);

-- Hot-path lookup: per-tenant ISBN → cached payload
CREATE UNIQUE INDEX IF NOT EXISTS isbn_cache_tenant_isbn_idx ON isbn_cache (tenant_id, isbn13);

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE isbn_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE isbn_cache FORCE ROW LEVEL SECURITY;

CREATE POLICY isbn_cache_tenant_isolation ON isbn_cache
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

-- ---------------------------------------------------------------------------
-- stack_app grants for the two new tables
-- stack_app was created in 0002; ALTER DEFAULT PRIVILEGES covers future tables,
-- but the two tables created above already exist, so we grant explicitly.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON books     TO stack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON isbn_cache TO stack_app;
