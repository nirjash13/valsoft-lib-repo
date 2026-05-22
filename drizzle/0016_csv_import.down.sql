-- =============================================================================
-- Migration Rollback: 0016_csv_import
-- Description: Drop import_jobs and import_rows tables.
-- Spec:        10 — CSV Import
-- =============================================================================

DROP TABLE IF EXISTS import_rows;
DROP TABLE IF EXISTS import_jobs;

ALTER TABLE books DROP COLUMN IF EXISTS enrichment_skipped;
