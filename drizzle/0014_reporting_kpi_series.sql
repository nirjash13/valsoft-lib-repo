-- =============================================================================
-- Migration: 0014_reporting_kpi_series
-- Description: Per-KPI daily series views for Overview sparklines + drill-down detail views.
-- Additive only (CREATE OR REPLACE VIEW / CREATE SCHEMA IF NOT EXISTS).
-- =============================================================================

-- -------------------------------------------------------------------------
-- 1. KPI Daily Series (30-day trailing window, one row per calendar day)
--    Used for Overview tile sparklines + prior-14-day delta calculations.
-- -------------------------------------------------------------------------

-- Active loans count snapshotted per day: loans checked out on or before that
-- day that were not yet returned by the end of that day.
CREATE OR REPLACE VIEW reporting.kpi_active_loans_by_day AS
WITH dates AS (
  SELECT GENERATE_SERIES(CURRENT_DATE - 29, CURRENT_DATE, '1 day'::interval)::date AS date_val
)
SELECT
  d.date_val AS date,
  (
    SELECT COUNT(*)::int
    FROM public.loans l
    WHERE l.tenant_id = assert_tenant()
      AND l.checked_out_at::date <= d.date_val
      AND (l.returned_at IS NULL OR l.returned_at::date > d.date_val)
  ) AS active_count
FROM dates d
ORDER BY d.date_val ASC;

-- Overdue loans count per day: active on that day and already past due_at.
CREATE OR REPLACE VIEW reporting.kpi_overdue_loans_by_day AS
WITH dates AS (
  SELECT GENERATE_SERIES(CURRENT_DATE - 29, CURRENT_DATE, '1 day'::interval)::date AS date_val
)
SELECT
  d.date_val AS date,
  (
    SELECT COUNT(*)::int
    FROM public.loans l
    WHERE l.tenant_id = assert_tenant()
      AND l.checked_out_at::date <= d.date_val
      AND (l.returned_at IS NULL OR l.returned_at::date > d.date_val)
      AND l.due_at::date < d.date_val
  ) AS overdue_count
FROM dates d
ORDER BY d.date_val ASC;

-- Holds queued count per day: holds that were queued on or before that day
-- and still in queued/ready status (status changes captured via updated_at).
-- We approximate using queued_at <= date and status IN ('queued','ready') for current state.
CREATE OR REPLACE VIEW reporting.kpi_holds_queued_by_day AS
WITH dates AS (
  SELECT GENERATE_SERIES(CURRENT_DATE - 29, CURRENT_DATE, '1 day'::interval)::date AS date_val
)
SELECT
  d.date_val AS date,
  (
    SELECT COUNT(*)::int
    FROM public.holds h
    WHERE h.tenant_id = assert_tenant()
      AND h.queued_at::date <= d.date_val
      AND h.updated_at::date >= d.date_val
      AND h.status IN ('queued', 'ready')
  ) AS holds_count
FROM dates d
ORDER BY d.date_val ASC;

-- Signups per day: new members created on that calendar day.
CREATE OR REPLACE VIEW reporting.kpi_signups_by_day AS
WITH dates AS (
  SELECT GENERATE_SERIES(CURRENT_DATE - 29, CURRENT_DATE, '1 day'::interval)::date AS date_val
)
SELECT
  d.date_val AS date,
  (
    SELECT COUNT(*)::int
    FROM public.members m
    WHERE m.tenant_id = assert_tenant()
      AND m.created_at::date = d.date_val
  ) AS signup_count
FROM dates d
ORDER BY d.date_val ASC;

-- -------------------------------------------------------------------------
-- 2. Drill-down detail views for Overview KPI tiles
-- -------------------------------------------------------------------------

-- Active loans detail: all currently checked-out loans with book + member info.
CREATE OR REPLACE VIEW reporting.drill_active_loans AS
SELECT
  l.id AS loan_id,
  b.title,
  b.isbn13 AS isbn,
  m.display_name,
  m.email,
  l.checked_out_at,
  l.due_at
FROM public.loans l
JOIN public.books b ON b.id = l.book_id AND b.tenant_id = assert_tenant()
JOIN public.members m ON m.id = l.member_id AND m.tenant_id = assert_tenant()
WHERE l.tenant_id = assert_tenant()
  AND l.returned_at IS NULL
ORDER BY l.due_at ASC;

-- Overdue loans detail: active loans where due_at < NOW().
CREATE OR REPLACE VIEW reporting.drill_overdue_loans AS
SELECT
  l.id AS loan_id,
  b.title,
  b.isbn13 AS isbn,
  m.display_name,
  m.email,
  l.checked_out_at,
  l.due_at,
  EXTRACT(DAY FROM NOW() - l.due_at)::int AS days_overdue
FROM public.loans l
JOIN public.books b ON b.id = l.book_id AND b.tenant_id = assert_tenant()
JOIN public.members m ON m.id = l.member_id AND m.tenant_id = assert_tenant()
WHERE l.tenant_id = assert_tenant()
  AND l.returned_at IS NULL
  AND l.due_at < NOW()
ORDER BY l.due_at ASC;

-- Holds queue detail: all currently pending holds with book + member info.
CREATE OR REPLACE VIEW reporting.drill_holds_queued AS
SELECT
  h.id AS hold_id,
  b.title,
  b.isbn13 AS isbn,
  m.display_name,
  m.email,
  h.queued_at,
  h.status
FROM public.holds h
JOIN public.books b ON b.id = h.book_id AND b.tenant_id = assert_tenant()
JOIN public.members m ON m.id = h.member_id AND m.tenant_id = assert_tenant()
WHERE h.tenant_id = assert_tenant()
  AND h.status IN ('queued', 'ready')
ORDER BY h.queued_at ASC;

-- Today's new member signups.
CREATE OR REPLACE VIEW reporting.drill_signups_today AS
SELECT
  m.id AS member_id,
  m.display_name,
  m.email,
  m.status,
  m.created_at
FROM public.members m
WHERE m.tenant_id = assert_tenant()
  AND m.created_at >= CURRENT_DATE
  AND m.created_at < CURRENT_DATE + INTERVAL '1 day'
ORDER BY m.created_at ASC;
