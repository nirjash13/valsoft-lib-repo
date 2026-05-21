<!-- written-by: claude-opus-4-7 (Stack platform lead) -->
# Spec 08 — Reporting: Dashboards + Natural-Language Queries + AI Usage Breakdown

**Date:** 2026-05-21
**Status:** Draft — Pending Sign-Off
**Satisfies assignment:** Interview ask — *"use CQRS patterns, reporting etc"* (initial-call notes) + Creativity (Bonus 3.5).
**Architecture refs:** [01 RADAR](../../docs/analysis/01-radar-analysis.md) §5 · [02 AI Features](../../docs/analysis/02-ai-features-research.md) §Tier 2 #9 · Spec 11 (AI usage)

---

## 1. What this feature is

The operator surface — what the librarian and tenant admin see when they want to understand the health of their library. Two layers:

1. **Pre-built dashboards** (HTML tables + sparklines): top circulated, overdue queue, popular subjects, zero-result searches (Spec 05), holds backlog, signups pipeline, AI-usage breakdown.
2. **Natural-language reporting** — type *"how many YA fiction loans last month?"* and get the answer. The model translates to a `ReportQuery` Zod schema (period, metric, dimension, filter), which the runtime maps to a SQL query against a fixed reporting view. **Never free-form SQL.**

The CQRS shape is explicit: command side (writes) goes through Server Actions / MediatR-style handlers (in Next.js: `next-safe-action` server actions); the query side (reads) goes through dedicated reporting views and RSC fetches. Reporting reads are denormalized; writes are normalized.

> **Value beyond the brief.** "Reporting" → 1 dashboard. We deliver: (a) **six pre-built tenant dashboards**, (b) **NL-to-structured queries** with a Zod-constrained schema (no free-form SQL = no injection surface), (c) an **AI-usage tab** that breaks down cost by feature × model × user, (d) **CSV/JSON export** of every dashboard, (e) **per-tenant scoping** with the same `withTenantTx` discipline the rest of the app uses.

## 2. Glossary

| Term | Plain-English meaning |
|------|------------------------|
| **Dashboard** | A pre-built read-only page with KPIs and tables. |
| **Reporting view** | A Postgres `VIEW` or materialized view denormalized for read efficiency. Lives under `reporting` schema. |
| **`ReportQuery`** | A Zod-typed object the model emits from a natural-language prompt. The runtime executes it against a whitelisted view set. |
| **Metric** | A measurable quantity: `loans_count`, `unique_borrowers`, `holds_placed`, `searches_zero_result`, `ai_cost_usd`. |
| **Dimension** | A grouping axis: `subject`, `year`, `member_role`, `feature`, `model`. |
| **Period** | A time window: `last_7_days`, `last_30_days`, `month_to_date`, `<ISO date>..<ISO date>`. |

## 3. Dashboards inventory

| Dashboard | Audience | Surfaces | Refresh |
|-----------|----------|----------|---------|
| **Overview** | Librarian, Admin | Active loans, overdue count, holds queued, new signups today, top circulated this week | 5 min |
| **Circulation** | Librarian, Admin | Loans/returns/holds by day, top borrowers, top books, average loan duration | 5 min |
| **Discovery** | Librarian, Admin | Top search queries, zero-result queries, click-through rate from search to borrow | 5 min |
| **Members** | Admin | Active vs pending vs inactive, signups by week, churn proxy (no-activity 90 days) | hourly |
| **AI Usage** | Admin | Spend by feature × model × user, refusal rate by feature, p95 latency, kill-switch status, quota remaining | 5 min |
| **Audit** | Admin | Filterable timeline of authoritative actions with actor + diff | live |

## 4. User stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a **librarian**, I need to see at a glance what's overdue and what's about to be overdue. | Must |
| US-02 | As a **tenant admin**, I need to type a question in plain English and get a chart/table answer. | Should |
| US-03 | As a **tenant admin**, I need to see how much AI is costing this month and where it's going. | Must |
| US-04 | As a **tenant admin**, I need to export any dashboard to CSV/JSON for offline use. | Should |
| US-05 | As a **librarian**, I need every dashboard to filter to my library only — no cross-tenant data ever. | Must (Spec 01) |
| US-06 | As a **tenant admin**, I need historical AI spend across the trailing 12 months so I can budget. | Should |
| US-07 | As a **librarian**, I need the zero-result searches list so I know which acquisitions to consider. | Should |
| US-08 | As a **system owner**, I need a platform-wide dashboard (all tenants) so I can spot abuse and capacity issues. | Should (operator mode — Spec 01) |

## 5. Functional requirements (EARS)

```
REQ-08-01: When a librarian or admin opens a dashboard, the system shall fetch all panel data via `withTenantTx`
RSC fetches against the `reporting` schema views; no panel data shall be computed in the request handler from
raw tables.

REQ-08-02: When a dashboard renders, every numeric tile shall include a sparkline of the trailing 14 days and a
delta vs the previous 14 days; clicking any tile drills down to a filterable detail table.

REQ-08-03: When an admin types a natural-language question in the NL Reports box, the system shall (a) invoke
`generateObject` with the `ReportQuery` Zod schema, (b) validate the produced object against the allowed metric
× dimension × period whitelist, (c) execute exactly one query against the matching `reporting.*` view, (d)
render the result as a table + optional chart, (e) include a "View as SQL" disclosure showing the executed
SQL for trust.

REQ-08-04: When the model produces a `ReportQuery` that references a metric or dimension not in the whitelist,
the runtime shall reject the query and ask the user to rephrase, listing supported metrics/dimensions.

REQ-08-05: When any dashboard is exported, the system shall produce a CSV with column headers + one JSON sibling
with the same data, both signed with a server-generated hash for tamper-evidence.

REQ-08-06: While AI usage exceeds 80% of the tenant cap, when the AI Usage dashboard renders, the system shall
present an amber banner "Approaching monthly AI quota — review usage or raise the cap."

REQ-08-07: When `chat_refusal` events accumulate over 24h, the AI Usage dashboard shall surface them grouped by
`refusal_reason` with sample messages truncated to 80 chars.

REQ-08-08: While a system owner is in operator-mode (Spec 01), when they open the platform dashboard, the system
shall aggregate cross-tenant KPIs and label every cell "platform-wide" with no per-tenant business data shown
unless an explicit drill-down occurs.

REQ-08-09: When a dashboard is rendered, the system shall include the last-refresh timestamp and a "Refresh now"
button that re-runs the views with cache bust.

REQ-08-10: When the audit dashboard loads, the system shall paginate with cursor over `(occurred_at, id)` and
support filtering by actor, action, subject_type, date range.
```

## 6. Acceptance scenarios (BDD)

### REQ-08-01 — tenant scoping
- **Given** a librarian at tenant A opens the Circulation dashboard
- **When** any panel queries
- **Then** SQL inspection (via test) confirms `app.tenant_id` is set to A and every view query filters by it via RLS
- **And** no row from tenant B is returned.

### REQ-08-03 — NL question happy
- **Given** a tenant admin types "how many YA fiction loans last 30 days?"
- **When** the system processes
- **Then** the model returns `{ metric: 'loans_count', dimension: 'subject', filter: { subject: 'YA fiction' }, period: 'last_30_days' }`
- **And** the runtime executes `SELECT COUNT(*) FROM reporting.loans_by_subject WHERE subject='YA fiction' AND period='last_30_days' AND tenant_id=current_setting('app.tenant_id')`
- **And** the table shows `42`; the "View SQL" disclosure shows that exact query.

### REQ-08-04 — unsupported metric refused
- **Given** the user asks "what's the average reading age of borrowers?"
- **When** the model returns `metric='avg_reading_age'`
- **Then** the runtime rejects with "I don't track reading age. Try: loans count, holds, signups, searches, AI cost."

### REQ-08-06 — AI quota warning
- **Given** tenant's monthly AI spend is at 82% of cap
- **When** the AI Usage dashboard renders
- **Then** the amber banner appears with the percentage and a Raise-Cap button (links to tenant settings).

### REQ-08-08 — system-owner cross-tenant aggregation
- **Given** a System Owner in operator-mode
- **When** the platform dashboard loads
- **Then** Active Tenants, Total MAU, Platform AI Cost render — but no tenant business detail (e.g., "Tenant A has 47 overdue loans") unless they click into a tenant.

## 7. Non-functional requirements

| ID | Plain meaning | EARS | Threshold |
|----|----------------|------|-----------|
| NFR-08-01 | Dashboard loads fast | When any dashboard opens, all panels shall complete within 1.2 s p95. | 1.2 s |
| NFR-08-02 | NL Report is bounded in cost | Per NL query, the LLM call shall use Sonnet 4.6 with `max_tokens` ≤ 256 (structured output only); per-question cost ≤ $0.01 p95. | $0.01 p95 |
| NFR-08-03 | View freshness | Reporting views shall be refreshed every 5 min (`pg_cron`); the Members view hourly. | 5 min / 60 min |
| NFR-08-04 | Export integrity | Every export shall include a SHA-256 hash + tenant_id + timestamp in the file header so disputes can be resolved. | Verified by integration test |
| NFR-08-05 | NL reports never write | The `ReportQuery` runtime shall only allow SELECTs against the `reporting` schema; any other shape is rejected before execution. | Verified by test + code-review checklist |

## 8. Edge cases

- NL question is too short ("loans") → ask "for what period?" via clarification round-trip.
- NL question is multilingual (French "combien de prêts hier?") → model handles both; tested in eval.
- Concurrent dashboard views by 20 users → views are read-only and cached at edge for 60 s per tenant.
- Materialized-view refresh failure → fall back to live VIEW; log alert.
- Export of 100k+ rows → stream as ndjson + CSV; do not buffer in memory.
- AI usage breakdown when no AI calls exist yet → render "No AI usage this period" tile instead of zero.

## 9. Open questions

| # | Question | Status |
|---|----------|--------|
| Q-08-01 | Should we offer scheduled email reports to admins (e.g., weekly digest)? | [NON-BLOCKING] — v2 |
| Q-08-02 | Will we offer a "chart this" toggle on NL results? | [NON-BLOCKING] — yes; trivial via Recharts |
| Q-08-03 | Should audit dashboard mask actor_id for member rows in non-admin view? | [NON-BLOCKING] — yes, librarians see actor name; admins see id |
| Q-08-04 | Materialized views or live views for v1? | [NON-BLOCKING] — live views with `pg_cron` REFRESH for top 3 KPIs only |

## 10. Sign-off

- [ ] **Product Owner:** ___________
- [ ] **Tech Lead:** ___________
- [ ] **AI reviewer (NL→SQL safety):** ___________
- [ ] Date approved: ___________
