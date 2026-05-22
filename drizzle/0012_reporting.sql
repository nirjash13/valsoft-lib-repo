-- =============================================================================
-- Migration: 0012_reporting
-- Description: Create reporting schema, matches_period helper, and reporting views.
-- =============================================================================

-- 1. Alter ai_usage to add latency_ms
ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS latency_ms integer;

-- 2. Create reporting schema
CREATE SCHEMA IF NOT EXISTS reporting;

-- 3. Create period matching helper function
CREATE OR REPLACE FUNCTION reporting.matches_period(p_date timestamptz, p_period text)
RETURNS boolean AS $$
DECLARE
  parts text[];
  start_date timestamptz;
  end_date timestamptz;
BEGIN
  IF p_period IS NULL OR p_period = '' THEN
    RETURN true;
  ELSIF p_period = 'last_7_days' THEN
    RETURN p_date >= NOW() - INTERVAL '7 days';
  ELSIF p_period = 'last_30_days' THEN
    RETURN p_date >= NOW() - INTERVAL '30 days';
  ELSIF p_period = 'month_to_date' THEN
    RETURN p_date >= date_trunc('month', NOW());
  ELSIF p_period LIKE '%..%' THEN
    parts := string_to_array(p_period, '..');
    IF array_length(parts, 1) = 2 THEN
      BEGIN
        start_date := parts[1]::timestamptz;
        -- Add 1 day to make the end date inclusive
        end_date := parts[2]::timestamptz + INTERVAL '1 day';
        RETURN p_date >= start_date AND p_date < end_date;
      EXCEPTION WHEN OTHERS THEN
        RETURN false;
      END;
    END IF;
  END IF;
  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. Create reporting views

-- Overview KPIs View
CREATE OR REPLACE VIEW reporting.overview_kpis AS
SELECT
  (SELECT COUNT(*)::int FROM public.loans WHERE returned_at IS NULL AND tenant_id = assert_tenant()) AS active_loans,
  (SELECT COUNT(*)::int FROM public.loans WHERE returned_at IS NULL AND due_at < NOW() AND tenant_id = assert_tenant()) AS overdue_loans,
  (SELECT COUNT(*)::int FROM public.holds WHERE status IN ('queued', 'ready') AND tenant_id = assert_tenant()) AS holds_queued,
  (SELECT COUNT(*)::int FROM public.members WHERE created_at >= CURRENT_DATE AND tenant_id = assert_tenant()) AS signups_today;

-- Top Circulated This Week View
CREATE OR REPLACE VIEW reporting.top_circulated_this_week AS
SELECT
  b.id AS book_id,
  b.title,
  b.authors,
  COUNT(l.id)::int AS checkout_count
FROM public.books b
JOIN public.loans l ON l.book_id = b.id AND l.tenant_id = assert_tenant()
WHERE l.checked_out_at >= NOW() - INTERVAL '7 days' AND b.tenant_id = assert_tenant()
GROUP BY b.id, b.title, b.authors
ORDER BY checkout_count DESC
LIMIT 5;

-- Circulation By Day View (for sparklines)
CREATE OR REPLACE VIEW reporting.circulation_by_day AS
WITH dates AS (
  SELECT GENERATE_SERIES(CURRENT_DATE - 30, CURRENT_DATE, '1 day'::interval)::date AS date_val
)
SELECT
  d.date_val AS date,
  (SELECT COUNT(*)::int FROM public.loans l WHERE l.tenant_id = assert_tenant() AND l.checked_out_at::date = d.date_val) AS checkout_count,
  (SELECT COUNT(*)::int FROM public.loans l WHERE l.tenant_id = assert_tenant() AND l.returned_at::date = d.date_val) AS return_count,
  (SELECT COUNT(*)::int FROM public.holds h WHERE h.tenant_id = assert_tenant() AND h.queued_at::date = d.date_val) AS hold_count
FROM dates d
ORDER BY d.date_val ASC;

-- Top Borrowers View
CREATE OR REPLACE VIEW reporting.top_borrowers AS
SELECT
  m.id AS member_id,
  m.display_name,
  m.email,
  COUNT(l.id)::int AS loan_count,
  COUNT(l.id) FILTER (WHERE l.returned_at IS NULL AND l.due_at < NOW())::int AS overdue_count
FROM public.members m
JOIN public.loans l ON l.member_id = m.id AND l.tenant_id = assert_tenant()
WHERE m.tenant_id = assert_tenant()
GROUP BY m.id, m.display_name, m.email
ORDER BY loan_count DESC
LIMIT 10;

-- Top Books Detailed View
CREATE OR REPLACE VIEW reporting.top_books_detailed AS
SELECT
  b.id AS book_id,
  b.title,
  b.isbn13 AS isbn,
  COUNT(l.id)::int AS checkout_count,
  COUNT(h.id) FILTER (WHERE h.status IN ('queued', 'ready'))::int AS hold_count,
  ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(l.returned_at, NOW()) - l.checked_out_at)) / 86400)::numeric, 0), 1)::numeric AS avg_loan_duration_days
FROM public.books b
LEFT JOIN public.loans l ON l.book_id = b.id AND l.tenant_id = assert_tenant()
LEFT JOIN public.holds h ON h.book_id = b.id AND h.tenant_id = assert_tenant()
WHERE b.tenant_id = assert_tenant() AND b.deleted_at IS NULL
GROUP BY b.id, b.title, b.isbn13
ORDER BY checkout_count DESC
LIMIT 10;

-- Loan Duration Stats View
CREATE OR REPLACE VIEW reporting.loan_duration_stats AS
SELECT
  ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (returned_at - checked_out_at)) / 86400)::numeric, 0), 1)::numeric AS avg_loan_duration_days,
  ROUND(COALESCE(MAX(EXTRACT(EPOCH FROM (returned_at - checked_out_at)) / 86400)::numeric, 0), 1)::numeric AS max_loan_duration_days
FROM public.loans
WHERE tenant_id = assert_tenant() AND returned_at IS NOT NULL;

-- Zero Result Searches View
CREATE OR REPLACE VIEW reporting.zero_result_searches AS
SELECT
  query,
  COUNT(*)::int AS search_count,
  MAX(created_at) AS last_searched_at
FROM public.search_zero_result_log
WHERE tenant_id = assert_tenant()
GROUP BY query
ORDER BY search_count DESC
LIMIT 50;

-- Member Status Stats View
CREATE OR REPLACE VIEW reporting.member_status_stats AS
SELECT
  status::text,
  COUNT(*)::int AS count
FROM public.members
WHERE tenant_id = assert_tenant() AND deleted_at IS NULL
GROUP BY status;

-- Member Signups By Week View
CREATE OR REPLACE VIEW reporting.member_signups_by_week AS
SELECT
  date_trunc('week', created_at)::date AS week_start,
  COUNT(*)::int AS signup_count
FROM public.members
WHERE tenant_id = assert_tenant() AND deleted_at IS NULL
GROUP BY date_trunc('week', created_at)
ORDER BY week_start ASC;

-- Member Churn Proxy View
CREATE OR REPLACE VIEW reporting.member_churn_proxy AS
SELECT
  m.id AS member_id,
  m.display_name,
  m.email,
  m.created_at,
  MAX(l.checked_out_at) AS last_activity_at
FROM public.members m
LEFT JOIN public.loans l ON l.member_id = m.id AND l.tenant_id = assert_tenant()
WHERE m.tenant_id = assert_tenant()
  AND m.status = 'active'
  AND m.deleted_at IS NULL
GROUP BY m.id, m.display_name, m.email, m.created_at
HAVING COALESCE(MAX(l.checked_out_at), m.created_at) < NOW() - INTERVAL '90 days'
ORDER BY last_activity_at ASC NULLS FIRST;

-- Chat Refusals 24h View
CREATE OR REPLACE VIEW reporting.chat_refusals_24h AS
SELECT
  refusal_reason::text AS refusal_reason,
  COUNT(*)::int AS refusal_count,
  (
    SELECT string_agg(SUBSTRING(cr2.user_message FROM 1 FOR 80), ' || ')
    FROM (
      SELECT user_message
      FROM public.chat_refusals cr2
      WHERE cr2.refusal_reason = cr.refusal_reason
        AND cr2.tenant_id = assert_tenant()
        AND cr2.created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY cr2.created_at DESC
      LIMIT 3
    ) cr2
  ) AS sample_messages
FROM public.chat_refusals cr
WHERE cr.tenant_id = assert_tenant()
  AND cr.created_at >= NOW() - INTERVAL '24 hours'
GROUP BY cr.refusal_reason;

-- AI Latency And Quota View
CREATE OR REPLACE VIEW reporting.ai_latency_and_quota AS
SELECT
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95_latency_ms,
  COALESCE(SUM(cost_usd), 0)::numeric(10,4) AS total_spend_usd
FROM public.ai_usage
WHERE tenant_id = assert_tenant()
  AND created_at >= date_trunc('month', NOW());

-- Audit Logs Timeline View
CREATE OR REPLACE VIEW reporting.audit_logs_timeline AS
SELECT
  id,
  tenant_id,
  actor_id,
  action,
  subject_type,
  subject_id,
  before_json,
  after_json,
  occurred_at
FROM public.audit_log
WHERE tenant_id = assert_tenant();

-- Public Books View (Supporting Spec 09)
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

-- NL Query Dimensional Views:

-- 1. Loans by Subject
CREATE OR REPLACE VIEW reporting.loans_by_subject AS
SELECT
  s.subject,
  COUNT(l.id)::int AS loans_count,
  COUNT(DISTINCT l.member_id)::int AS unique_borrowers,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.books b
JOIN public.loans l ON l.book_id = b.id AND l.tenant_id = assert_tenant()
CROSS JOIN unnest(b.subjects) AS s(subject)
WHERE b.tenant_id = assert_tenant()
  AND reporting.matches_period(l.checked_out_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY s.subject;

-- 2. Loans by Year
CREATE OR REPLACE VIEW reporting.loans_by_year AS
SELECT
  to_char(l.checked_out_at, 'YYYY') AS year,
  COUNT(l.id)::int AS loans_count,
  COUNT(DISTINCT l.member_id)::int AS unique_borrowers,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.loans l
WHERE l.tenant_id = assert_tenant()
  AND reporting.matches_period(l.checked_out_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY to_char(l.checked_out_at, 'YYYY');

-- 3. Loans by Member Role
CREATE OR REPLACE VIEW reporting.loans_by_member_role AS
SELECT
  m.role::text AS member_role,
  COUNT(l.id)::int AS loans_count,
  COUNT(DISTINCT l.member_id)::int AS unique_borrowers,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.loans l
JOIN public.members m ON l.member_id = m.id AND m.tenant_id = assert_tenant()
WHERE l.tenant_id = assert_tenant()
  AND reporting.matches_period(l.checked_out_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY m.role;

-- 4. Loans Total
CREATE OR REPLACE VIEW reporting.loans_total AS
SELECT
  COUNT(l.id)::int AS loans_count,
  COUNT(DISTINCT l.member_id)::int AS unique_borrowers,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.loans l
WHERE l.tenant_id = assert_tenant()
  AND reporting.matches_period(l.checked_out_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'));

-- 5. Holds by Subject
CREATE OR REPLACE VIEW reporting.holds_by_subject AS
SELECT
  s.subject,
  COUNT(h.id)::int AS holds_placed,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.books b
JOIN public.holds h ON h.book_id = b.id AND h.tenant_id = assert_tenant()
CROSS JOIN unnest(b.subjects) AS s(subject)
WHERE b.tenant_id = assert_tenant()
  AND reporting.matches_period(h.queued_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY s.subject;

-- 6. Holds by Year
CREATE OR REPLACE VIEW reporting.holds_by_year AS
SELECT
  to_char(h.queued_at, 'YYYY') AS year,
  COUNT(h.id)::int AS holds_placed,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.holds h
WHERE h.tenant_id = assert_tenant()
  AND reporting.matches_period(h.queued_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY to_char(h.queued_at, 'YYYY');

-- 7. Holds by Member Role
CREATE OR REPLACE VIEW reporting.holds_by_member_role AS
SELECT
  m.role::text AS member_role,
  COUNT(h.id)::int AS holds_placed,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.holds h
JOIN public.members m ON h.member_id = m.id AND m.tenant_id = assert_tenant()
WHERE h.tenant_id = assert_tenant()
  AND reporting.matches_period(h.queued_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY m.role;

-- 8. Holds Total
CREATE OR REPLACE VIEW reporting.holds_total AS
SELECT
  COUNT(h.id)::int AS holds_placed,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.holds h
WHERE h.tenant_id = assert_tenant()
  AND reporting.matches_period(h.queued_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'));

-- 9. Searches Zero Result by Year
CREATE OR REPLACE VIEW reporting.searches_zero_result_by_year AS
SELECT
  to_char(s.created_at, 'YYYY') AS year,
  COUNT(s.id)::int AS searches_zero_result,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.search_zero_result_log s
WHERE s.tenant_id = assert_tenant()
  AND reporting.matches_period(s.created_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY to_char(s.created_at, 'YYYY');

-- 10. Searches Zero Result by Member Role
CREATE OR REPLACE VIEW reporting.searches_zero_result_by_member_role AS
SELECT
  COALESCE(m.role::text, 'guest') AS member_role,
  COUNT(s.id)::int AS searches_zero_result,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.search_zero_result_log s
LEFT JOIN public.members m ON s.user_id = m.auth0_user_id AND m.tenant_id = assert_tenant()
WHERE s.tenant_id = assert_tenant()
  AND reporting.matches_period(s.created_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY m.role;

-- 11. Searches Zero Result Total
CREATE OR REPLACE VIEW reporting.searches_zero_result_total AS
SELECT
  COUNT(s.id)::int AS searches_zero_result,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.search_zero_result_log s
WHERE s.tenant_id = assert_tenant()
  AND reporting.matches_period(s.created_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'));

-- 12. AI Cost by Feature
CREATE OR REPLACE VIEW reporting.ai_cost_by_feature AS
SELECT
  a.feature,
  SUM(a.cost_usd)::numeric(10,4) AS ai_cost_usd,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.ai_usage a
WHERE a.tenant_id = assert_tenant()
  AND reporting.matches_period(a.created_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY a.feature;

-- 13. AI Cost by Model
CREATE OR REPLACE VIEW reporting.ai_cost_by_model AS
SELECT
  a.model,
  SUM(a.cost_usd)::numeric(10,4) AS ai_cost_usd,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.ai_usage a
WHERE a.tenant_id = assert_tenant()
  AND reporting.matches_period(a.created_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY a.model;

-- 14. AI Cost by Year
CREATE OR REPLACE VIEW reporting.ai_cost_by_year AS
SELECT
  to_char(a.created_at, 'YYYY') AS year,
  SUM(a.cost_usd)::numeric(10,4) AS ai_cost_usd,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.ai_usage a
WHERE a.tenant_id = assert_tenant()
  AND reporting.matches_period(a.created_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY to_char(a.created_at, 'YYYY');

-- 15. AI Cost by Member Role
CREATE OR REPLACE VIEW reporting.ai_cost_by_member_role AS
SELECT
  COALESCE(m.role::text, 'unknown') AS member_role,
  SUM(a.cost_usd)::numeric(10,4) AS ai_cost_usd,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.ai_usage a
LEFT JOIN public.chat_threads t ON a.thread_id = t.id AND t.tenant_id = assert_tenant()
LEFT JOIN public.members m ON t.member_id = m.id AND m.tenant_id = assert_tenant()
WHERE a.tenant_id = assert_tenant()
  AND reporting.matches_period(a.created_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'))
GROUP BY m.role;

-- 16. AI Cost Total
CREATE OR REPLACE VIEW reporting.ai_cost_total AS
SELECT
  SUM(a.cost_usd)::numeric(10,4) AS ai_cost_usd,
  COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days') AS period
FROM public.ai_usage a
WHERE a.tenant_id = assert_tenant()
  AND reporting.matches_period(a.created_at, COALESCE(NULLIF(current_setting('app.current_period', true), ''), 'last_30_days'));
