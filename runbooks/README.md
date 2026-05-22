<!-- written-by: writer-haiku | model: haiku -->
# Stack Operations Runbooks

Runbooks are step-by-step procedures for on-call engineers responding to incidents. Each runbook addresses a specific failure mode and provides clear, actionable steps.

## Runbooks

| Runbook | When to use | Severity | Time to resolve |
|---------|-------------|----------|-----------------|
| [AI Feature Kill Switch](ai-feature-kill-switch.md) | An AI feature is misbehaving (hallucinating, returning off-catalog data, or affecting user experience) and needs to be disabled immediately without a deploy. | High | 5–10 minutes |
| [Production Rollback](production-rollback.md) | A production deploy introduced a critical bug (failed smoke tests, data corruption, or widespread user impact) and must be rolled back immediately. | Critical | 2–5 minutes (automatic) + verification |
| [Incident: Cross-Tenant Data Leak](incident-cross-tenant-leak.md) | A suspected cross-tenant data leak is detected (Langfuse shows cross-tenant rows, user reports seeing another customer's data, or a security scan finds a violation). | Critical | Immediate containment + 1 hour investigation |

## How to use this guide

1. **Identify the incident type** — which runbook matches your situation?
2. **Follow the steps in order** — each step builds on the previous one.
3. **Use the checklist** — check off each step as you complete it. Do not skip steps.
4. **Record the timeline** — note timestamps for each action (when you detected, contained, investigated, resolved).
5. **Escalate if unsure** — if any step is unclear or you hit a blocker, page the on-call tech lead immediately.

## Escalation contacts

- **AI/LLM behavior issue** → AI reviewer (Slack: `#ai-platform`)
- **Database or isolation issue** → Platform lead (Slack: `#platform`)
- **Security concern** → Security lead (Slack: `#security`)
- **Deployment issue** → DevOps / Vercel expert (Slack: `#deployments`)

## Related documentation

- **Spec 11 — AI Governance** (`project_docs/specs/11-ai-governance.spec.md`) — how AI safety is built into Stack.
- **Spec 12 § 9 — AI-in-SDLC** — where AI is in the pipeline and how CI gates prevent these incidents.
- **ADR-0001 — Eval-as-CI-Gate** (`docs/decisions/0001-eval-as-ci-gate.md`) — how eval gates catch AI regressions before production.
- **Langfuse observability** — traces all AI calls with tenant and feature tags; access via the production dashboard.
- **Sentry error tracking** — application errors are logged with tenant context.
- **Vercel deployment history** — review recent deploys and rollbacks.
