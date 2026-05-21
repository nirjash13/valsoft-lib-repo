# Custom Lint Rules

These Biome plugin rules enforce the multi-tenancy architecture constraints described in
`.claude/CLAUDE.md` §"Multi-Tenancy". They are **not implemented in Run A** — they land in
Run B alongside the full Biome configuration additions.

## Planned rules

### `no-bare-db-call`

Flags any direct call to `db.select()`, `db.insert()`, `db.update()`, `db.delete()` from
outside `lib/db/`. All tenant-scoped data access must go through `withTenantTx`.

### `no-direct-llm-sdk`

Flags any import of a raw LLM provider SDK (`openai`, `@anthropic-ai/sdk`, `groq-sdk`).
All model calls must go through `lib/ai/gateway.ts`.

### `no-set-app-tenant-id`

Flags any raw SQL string containing `SET app.tenant_id` (without `LOCAL`).
`SET LOCAL` is the only allowed form; plain `SET` leaks across PgBouncer connections.

## Why not in Run A?

Biome plugin authoring requires the full Biome config to be wired up and working.
The priority for Run A is getting the schema, client, and `withTenantTx` correct
so Run B can build on top of a solid foundation.
