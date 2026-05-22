-- =============================================================================
-- Rollback: 0013_public_catalog
-- Description: Restore original reporting.public_books view, drop blocklist column.
-- =============================================================================

-- 1. Restore original reporting.public_books view (from migration 0012)
DROP VIEW IF EXISTS reporting.public_books;
CREATE OR REPLACE VIEW reporting.public_books AS
SELECT
  id,
  tenant_id,
  isbn13,
  title,
  authors,
  year,
  publisher,
  page_count,
  subjects,
  language,
  cover_url,
  description,
  custom_fields,
  created_at,
  updated_at
FROM public.books
WHERE tenant_id = assert_tenant()
  AND deleted_at IS NULL;

-- 2. Drop the subject blocklist column
ALTER TABLE public.tenants
  DROP COLUMN IF EXISTS public_catalog_subject_blocklist;
