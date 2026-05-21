-- =============================================================================
-- Migration: 0005_books_updated_at_precision
-- Description: Truncate created_at / updated_at on books to millisecond
--              precision (timestamptz(3)) so optimistic-concurrency tokens
--              round-trip through JS Date / ISO string without false-positive
--              409 Conflict errors.
--
-- Root cause: JS Date has ms precision; Postgres timestamptz has µs precision.
--             The WHERE clause in update-book.ts compares new Date(isoString)
--             against the DB value — if the stored µs component is non-zero the
--             comparison always fails on the first update of any book.
-- Fix:        Store at ms precision so storage value = parsed JS Date value.
-- Spec:       02 — Book Management (critic Run A finding F-5)
-- =============================================================================

ALTER TABLE books
  ALTER COLUMN created_at TYPE timestamptz(3) USING created_at,
  ALTER COLUMN updated_at TYPE timestamptz(3) USING updated_at;
