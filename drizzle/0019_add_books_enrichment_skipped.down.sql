-- Rollback for 0019_add_books_enrichment_skipped.
ALTER TABLE books DROP COLUMN IF EXISTS enrichment_skipped;
