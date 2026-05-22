-- =============================================================================
-- Migration: 0012_reporting (Rollback)
-- Description: Drop reporting views, functions, schema, and latency_ms column.
-- =============================================================================

-- Drop NL Query views
DROP VIEW IF EXISTS reporting.ai_cost_total;
DROP VIEW IF EXISTS reporting.ai_cost_by_member_role;
DROP VIEW IF EXISTS reporting.ai_cost_by_year;
DROP VIEW IF EXISTS reporting.ai_cost_by_model;
DROP VIEW IF EXISTS reporting.ai_cost_by_feature;
DROP VIEW IF EXISTS reporting.searches_zero_result_total;
DROP VIEW IF EXISTS reporting.searches_zero_result_by_member_role;
DROP VIEW IF EXISTS reporting.searches_zero_result_by_year;
DROP VIEW IF EXISTS reporting.holds_total;
DROP VIEW IF EXISTS reporting.holds_by_member_role;
DROP VIEW IF EXISTS reporting.holds_by_year;
DROP VIEW IF EXISTS reporting.holds_by_subject;
DROP VIEW IF EXISTS reporting.loans_total;
DROP VIEW IF EXISTS reporting.loans_by_member_role;
DROP VIEW IF EXISTS reporting.loans_by_year;
DROP VIEW IF EXISTS reporting.loans_by_subject;

-- Drop Dashboard views
DROP VIEW IF EXISTS reporting.public_books;
DROP VIEW IF EXISTS reporting.audit_logs_timeline;
DROP VIEW IF EXISTS reporting.ai_latency_and_quota;
DROP VIEW IF EXISTS reporting.chat_refusals_24h;
DROP VIEW IF EXISTS reporting.member_churn_proxy;
DROP VIEW IF EXISTS reporting.member_signups_by_week;
DROP VIEW IF EXISTS reporting.member_status_stats;
DROP VIEW IF EXISTS reporting.zero_result_searches;
DROP VIEW IF EXISTS reporting.loan_duration_stats;
DROP VIEW IF EXISTS reporting.top_books_detailed;
DROP VIEW IF EXISTS reporting.top_borrowers;
DROP VIEW IF EXISTS reporting.circulation_by_day;
DROP VIEW IF EXISTS reporting.top_circulated_this_week;
DROP VIEW IF EXISTS reporting.overview_kpis;

-- Drop period matching function
DROP FUNCTION IF EXISTS reporting.matches_period(timestamptz, text);

-- Drop reporting schema
DROP SCHEMA IF EXISTS reporting CASCADE;

-- Drop column latency_ms from ai_usage
ALTER TABLE public.ai_usage DROP COLUMN IF EXISTS latency_ms;
