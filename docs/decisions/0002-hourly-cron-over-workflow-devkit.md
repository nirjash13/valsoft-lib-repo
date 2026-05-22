<!-- written-by: writer-haiku | model: haiku -->
# ADR-0002 — Hourly Cron Routes Over Vercel Workflow DevKit

**Date:** 2026-05-21  
**Status:** Accepted  
**Deciders:** Platform lead + User

## Context

Stack has background work requirements: expiring stale holds (Spec 03), sending reminder emails (Spec 07), and archiving idle chat threads (Spec 06). These are periodic tasks that must run independently of HTTP requests, retry on failure, and preserve state across service restarts.

The `.claude/CLAUDE.md` stack baseline specified **Vercel Workflow DevKit** for this work — a durable, step-resumable system. However, when Spec 07 (Notifications) was implemented, the team discovered that:

1. Workflow DevKit has a **pay-per-invocation cost** and is designed for complex multi-day workflows, not hourly crons.
2. Stack's background work is **simple**: load state from Postgres, apply domain logic, record side effects. No state machine needed.
3. A **Vercel hourly cron function** (via `vercel.json` and `/api/cron/*` routes) is **free on the free tier**, has **fast feedback** (every hour), and is **self-healing** via route chaining (if a cron fails, the next hour tries again).

This decision records the deliberate deviation from the template and captures the rationale.

## Decision

Use **Vercel hourly cron** (`/api/cron/*` routes defined in `vercel.json`) for periodic background tasks instead of Workflow DevKit:

- Each background job is a Next.js Route Handler under `app/api/cron/`.
- The handler is guarded by `CRON_SECRET` (a random token sent by Vercel in the `Authorization` header).
- On failure, the cron naturally retries the next hour (self-healing).
- State is persisted in Postgres; no external queue or scheduler.
- Multiple cron routes can coexist (e.g., `/api/cron/expire-holds`, `/api/cron/send-reminders`); each runs independently on the Vercel cron schedule.

## Consequences

### Positive
- **Zero additional cost** — cron functions are included in Vercel's free tier.
- **Instant feedback** — changes to cron logic are live after the next deploy; no durable workflow state to unstick.
- **Simple to reason about** — the cron is just a Route Handler; no orchestration DSL to learn.
- **Self-healing retries** — failed cron is naturally retried the next hour without manual intervention.
- **Fast recovery from bugs** — if a cron introduces a bug, deploy a fix and the next hour is clean.

### Negative
- **No guaranteed delivery within an hour** — if Vercel restarts during a cron window, the window is skipped. Mitigated by using `>= last_run_time` predicates in the query (idempotent state transitions).
- **No distributed execution** — crons run on one Vercel node; no parallelism for large workloads. Stack's job sizes are small (expiring ~10 holds/hour); if this becomes a bottleneck, migrate to BullMQ + Redis.
- **Limited to hourly granularity** — cannot run every 5 minutes. Spec 03, 07, 06 all need hourly or longer; this is sufficient.
- **No built-in observability** — must instrument cron handlers with Sentry/Langfuse spans manually. Mitigated by a shared helper (`lib/cron/handler.ts`).

## Alternatives considered

1. **Vercel Workflow DevKit** — originally mandated in the stack template. Rejected because cost + complexity outweigh the durability benefit for these simple tasks.
2. **AWS Lambda + EventBridge** — rejected because it requires AWS accounts and adds vendor lock-in beyond Vercel.
3. **BullMQ + Redis** — rejected because it adds infrastructure (Redis) and cost; Vercel cron is sufficient for the current job volume.
4. **Scheduled Next.js API routes via external service (e.g., cron.io)** — rejected because it requires a third-party dependency and introduces a new failure point.

## References

- Spec 03 § Notifications: expireStaleHolds cron
- Spec 07 § Notifications: send-reminders and send-batch delivery
- Spec 06 § Chat: thread archival (deferred)
- Implementation: `app/api/cron/expire-holds.ts`, `app/api/cron/send-reminders.ts`, `vercel.json` cron config
- Architecture: `.claude/CLAUDE.md` § Background Work (updated to reflect cron, not Workflow DevKit)
