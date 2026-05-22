-- =============================================================================
-- Rollback: 0014_reporting_kpi_series
-- Description: Drop per-KPI daily series and drill-down views.
-- =============================================================================

DROP VIEW IF EXISTS reporting.drill_signups_today;
DROP VIEW IF EXISTS reporting.drill_holds_queued;
DROP VIEW IF EXISTS reporting.drill_overdue_loans;
DROP VIEW IF EXISTS reporting.drill_active_loans;
DROP VIEW IF EXISTS reporting.kpi_signups_by_day;
DROP VIEW IF EXISTS reporting.kpi_holds_queued_by_day;
DROP VIEW IF EXISTS reporting.kpi_overdue_loans_by_day;
DROP VIEW IF EXISTS reporting.kpi_active_loans_by_day;
