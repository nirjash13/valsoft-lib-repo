/**
 * resolveTenantBySlug — look up a tenant's public catalog config by URL slug.
 *
 * Used by the public catalog API routes (Spec 09) to map the URL segment
 * (e.g., "acme" in `/api/catalog/acme/books`) to the tenant UUID and config.
 *
 * WHY owner pool: There is no Auth0 session on public requests, so app.tenant_id
 * is not bound. The tenants table has no RLS (it's not tenant-scoped), but the
 * runtime connection (stack_app) may still need the GUC for other tables in the
 * same request. We use the owner pool to avoid interference.
 *
 * CACHING: Results are cached in-memory for 5 minutes to avoid repeated DB
 * round-trips on high-traffic public pages. Cache is per-process (serverless
 * function instance), so cold starts always hit the DB.
 */

import { getOwnerPool } from "@/lib/db/owner-pool";
import { CatalogDisabledError, TenantNotFoundError } from "./errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantCatalogConfig {
  tenantId: string;
  tenantName: string;
  publicCatalogEnabled: boolean;
  publicCatalogSubjectBlocklist: string[];
}

// ---------------------------------------------------------------------------
// In-memory cache (per-process, 5 min TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  config: TenantCatalogConfig;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves a tenant slug to its catalog configuration.
 *
 * @param slug - The tenant URL slug (e.g., "acme").
 * @returns The tenant's catalog config.
 * @throws {TenantNotFoundError} if no tenant matches the slug.
 */
export async function resolveTenantBySlug(slug: string): Promise<TenantCatalogConfig> {
  // Check cache first
  const now = Date.now();
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > now) {
    return cached.config;
  }

  const pool = getOwnerPool();
  const client = await pool.connect();
  try {
    const res = await client.query<{
      id: string;
      name: string;
      public_catalog_enabled: boolean;
      public_catalog_subject_blocklist: string[];
    }>(
      `SELECT id, name, public_catalog_enabled, public_catalog_subject_blocklist
       FROM tenants WHERE slug = $1 LIMIT 1`,
      [slug],
    );

    if (res.rows.length === 0) {
      throw new TenantNotFoundError(slug);
    }

    // biome-ignore lint/style/noNonNullAssertion: length check guarantees row
    const row = res.rows[0]!;

    const config: TenantCatalogConfig = {
      tenantId: row.id,
      tenantName: row.name,
      publicCatalogEnabled: row.public_catalog_enabled,
      publicCatalogSubjectBlocklist: row.public_catalog_subject_blocklist ?? [],
    };

    // Populate cache
    cache.set(slug, { config, expiresAt: now + CACHE_TTL_MS });

    return config;
  } finally {
    client.release();
  }
}

/**
 * Resolves tenant by slug and asserts the public catalog is enabled.
 *
 * Convenience wrapper that combines resolution + enablement check.
 *
 * @throws {TenantNotFoundError} if slug doesn't match.
 * @throws {CatalogDisabledError} if catalog is disabled (REQ-09-05).
 */
export async function requirePublicCatalog(slug: string): Promise<TenantCatalogConfig> {
  const config = await resolveTenantBySlug(slug);
  if (!config.publicCatalogEnabled) {
    throw new CatalogDisabledError(slug);
  }
  return config;
}

/**
 * Invalidates the cached config for a tenant slug.
 * Called after admin toggles (REQ-09-05) to ensure the next request sees the change.
 */
export function invalidateTenantCatalogCache(slug: string): void {
  cache.delete(slug);
}

/** Clears the entire cache. Useful in tests. */
export function clearTenantCatalogCache(): void {
  cache.clear();
}
