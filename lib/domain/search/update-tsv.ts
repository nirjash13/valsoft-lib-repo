/**
 * update-tsv — documentation module for the tsvector GENERATED column.
 *
 * The `books.tsv` column is `GENERATED ALWAYS AS (...) STORED` in Postgres
 * (migration 0008_search_discovery.sql). Postgres automatically recomputes the
 * column value whenever `title`, `authors`, `subjects`, or `description` change
 * on INSERT or UPDATE. There is no application-layer step required.
 *
 * This module is intentionally a no-op at runtime. It exists to:
 *   1. Serve as the documentation home for the tsv update semantics.
 *   2. Provide a hook for any future manual recompute (e.g., after a dictionary
 *      change or a bulk import via COPY that bypasses triggers).
 *
 * Manual recompute (if ever needed):
 *   Run this SQL against the tenant's schema:
 *
 *     UPDATE books SET title = title WHERE tenant_id = $1;
 *
 *   This triggers a no-op UPDATE that forces Postgres to recompute the GENERATED
 *   column. Use `CONCURRENTLY`-equivalent batching for large tables.
 *
 * For mass re-indexing after a configuration change (e.g., switching from
 * 'english' to 'simple' dictionary), see the Spec 05 follow-up items.
 */

// No runtime exports — intentional. The DB handles tsvector maintenance.
export {};
