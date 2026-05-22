-- =============================================================================
-- Down Migration: 0008_search_discovery
-- Description: Reverses the search discovery migration.
--              Drops book_embeddings, search_zero_result_log, trigram indexes,
--              and the tsv GENERATED column from books.
-- WARNING: DROP TABLE operations are irreversible. Ensure all embeddings have
--          been backed up before running this in a non-development environment.
-- =============================================================================

-- Drop dependent tables first (avoids FK constraint errors)
DROP TABLE IF EXISTS book_embeddings;
DROP TABLE IF EXISTS search_zero_result_log;

-- Drop indexes on books (DROP INDEX is safe even if column still exists)
DROP INDEX IF EXISTS books_tsv_gin;
DROP INDEX IF EXISTS books_title_trgm;
DROP INDEX IF EXISTS books_authors_trgm;

-- Remove the generated tsvector column from books, then the functions it and
-- the trigram index depend on. Order matters: the GENERATED column depends on
-- books_search_tsv(), and books_authors_trgm depended on immutable_array_to_string()
-- (already dropped above with the index), so the column must be dropped first.
ALTER TABLE books DROP COLUMN IF EXISTS tsv;
DROP FUNCTION IF EXISTS books_search_tsv(text, text[], text[], text);
DROP FUNCTION IF EXISTS immutable_array_to_string(text[], text);
