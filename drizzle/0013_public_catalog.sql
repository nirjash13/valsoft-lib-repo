-- =============================================================================
-- Migration: 0013_public_catalog
-- Description: Public catalog support (Spec 09).
--              Adds subject blocklist column to tenants.
--              Replaces reporting.public_books view with availability data and
--              defense-in-depth blocklist filtering.
-- =============================================================================

-- 1. Add subject blocklist column to tenants (REQ-09-06)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS public_catalog_subject_blocklist text[] NOT NULL DEFAULT '{}';

-- 2. Replace reporting.public_books view
--    Original (migration 0012) only exposed book columns.
--    New version adds:
--      - availability_status: 'available' | 'on_loan'
--      - loan_due_at: earliest active loan due date (aggregate, no member info)
--      - hold_count: number of queued/ready holds (aggregate, no member info)
--      - Defense-in-depth: excludes books whose subjects overlap the tenant blocklist
--    Security: NO member names, NO loan member_id, NO hold member_id, NO audit data.
DROP VIEW IF EXISTS reporting.public_books;
CREATE OR REPLACE VIEW reporting.public_books AS
SELECT
  b.id,
  b.tenant_id,
  b.isbn13,
  b.title,
  b.authors,
  b.year,
  b.publisher,
  b.page_count,
  b.subjects,
  b.language,
  b.cover_url,
  b.description,
  b.updated_at,
  -- Availability: aggregate only — no member PII (REQ-09-02, REQ-09-07)
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.book_id = b.id AND l.tenant_id = b.tenant_id AND l.returned_at IS NULL
    ) THEN 'on_loan'
    ELSE 'available'
  END AS availability_status,
  (
    SELECT MIN(l.due_at)
    FROM public.loans l
    WHERE l.book_id = b.id AND l.tenant_id = b.tenant_id AND l.returned_at IS NULL
  ) AS loan_due_at,
  (
    SELECT COUNT(*)::int
    FROM public.holds h
    WHERE h.book_id = b.id AND h.tenant_id = b.tenant_id AND h.status IN ('queued', 'ready')
  ) AS hold_count
FROM public.books b
WHERE b.tenant_id = assert_tenant()
  AND b.deleted_at IS NULL
  -- Defense-in-depth blocklist (REQ-09-06): exclude books whose subjects
  -- overlap with the tenant's blocklist. The application layer applies the
  -- same filter, but the view enforces it even if the app layer has a bug.
  AND NOT EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = b.tenant_id
      AND t.public_catalog_subject_blocklist != '{}'
      AND b.subjects && t.public_catalog_subject_blocklist
  );
