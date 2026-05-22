-- =============================================================================
-- Migration: 0019_add_books_enrichment_skipped
-- Description: Add the missing `enrichment_skipped` column to `books`.
--
-- Why this exists:
--   Migration 0016 declares this column (ALTER TABLE books ADD COLUMN ...), but
--   on databases provisioned before that line was added to the 0016 file the
--   column was never created — 0016's import_jobs/import_rows tables exist while
--   books.enrichment_skipped does not. Because lib/db/schema/books.ts declares
--   `enrichmentSkipped`, Drizzle emits it in every SELECT against `books`, so
--   every books query failed at runtime with:
--     ERROR 42703  column "enrichment_skipped" does not exist
--   which broke /books, /books/[id], /books/[id]/edit and /books/trash.
--
-- Per .claude/rules/migrations.md the already-applied 0016 file is not edited;
-- this new migration carries the fix.
--
-- Idempotent: IF NOT EXISTS makes this a no-op where 0016 ran fully.
-- Non-destructive: adding a NOT NULL column with a constant DEFAULT is a
-- metadata-only operation in modern Postgres (no table rewrite).
-- =============================================================================

ALTER TABLE books ADD COLUMN IF NOT EXISTS enrichment_skipped boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN books.enrichment_skipped IS 'True when the book was imported without an ISBN (no enrichment applied). Librarian can enrich later.';
