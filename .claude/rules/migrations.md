# Migration Rules

## Scope
Applies when editing Drizzle schema under `lib/db/schema/**` and generated migration SQL under `drizzle/**`.

## Rules

- Keep one logical schema change per migration when possible. Splitting a "add table + add foreign key + add index" into three files makes diffs reviewable and rollbacks surgical.
- Migrations are generated from `lib/db/schema/**` via `pnpm drizzle-kit generate`. Hand-edit the generated SQL only to (a) add RLS policies for new tenant tables, (b) add custom indexes (pgvector HNSW, GIN over `tsvector`) that drizzle-kit does not yet emit, (c) add data migrations.
- **Every tenant-scoped table** must include in the same migration:
  - `tenant_id uuid NOT NULL`
  - `CREATE INDEX … ON <table> (tenant_id, …);` (composite, tenant-first)
  - `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
  - `ALTER TABLE <table> FORCE ROW LEVEL SECURITY;`
  - `CREATE POLICY <table>_tenant_isolation ON <table> USING (tenant_id = current_setting('app.tenant_id', true)::uuid);`
- CI runs a migration test that enumerates `pg_class` and fails if any user table is missing `relrowsecurity AND relforcerowsecurity` (Spec 01 NFR-01-05).
- The `audit_log` table is append-only: `REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;` in its migration.

## Workflow

```bash
# 1. Edit lib/db/schema/<file>.ts
# 2. Generate SQL
pnpm drizzle-kit generate
# 3. Review the generated file under drizzle/ — DIFF IT BEFORE COMMIT
# 4. If RLS / data migration / extension setup needed, hand-edit the generated SQL
# 5. Apply against a local or Neon test branch
pnpm drizzle-kit migrate
# 6. Roll back / re-apply against the test branch to verify the migration is repeatable
```

## Per-PR safety

- Every PR with a migration creates a **Neon preview branch** for that PR (Spec 12 §6). The migration runs against the preview branch before the app deploys to the preview URL.
- **Destructive migrations** — `DROP COLUMN`, `DROP TABLE`, `ALTER COLUMN … TYPE`, backfilling a `NOT NULL` over existing rows — require the `safety:reviewed` GitHub label. CI refuses to merge without it (Spec 12 §6).
- Document the rollback strategy in the PR description for any destructive or data-migrating change.

## Safety rails

- Never modify an already-applied migration file. Create a new migration instead.
- Treat data migrations (populating/transforming rows across tenants) as high-risk — they must respect tenant boundaries even when run by a privileged role.
- pgvector and `tsvector` index changes can be expensive — use `CREATE INDEX CONCURRENTLY` in production-bound migrations (drizzle-kit will not emit this by default; hand-edit the generated SQL).
- Production rollouts run the migration against the staging Neon branch first via the Vercel build hook; the prod branch only runs after staging succeeds (Spec 12 §6, Vercel deploy pipeline).

## References

- `project_docs/specs/01-foundation-multi-tenancy-auth.spec.md` — RLS + audit log requirements.
- `docs/analysis/04-multi-tenant-data-model.md` — schema design and the four-layer isolation model.
- `project_docs/specs/12-sdlc-cicd-pipeline.spec.md` §6 — destructive-migration gate.
