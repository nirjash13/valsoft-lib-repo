/**
 * Per-tenant ISBN cache — read and write via the active transaction.
 *
 * TTL is enforced at the application layer: puts set expires_at = now() + TTL;
 * gets reject rows where expires_at < now().
 *
 * NFR-02-02: identical preview within a tenant for the same ISBN within 24 h.
 */

import { isbnCache } from "@/lib/db/schema/isbn-cache";
import type { TxClient } from "@/lib/db/with-tenant-tx";
import { and, eq, gt, sql } from "drizzle-orm";
import type { BookRecord } from "./schemas";

// ---------------------------------------------------------------------------
// getCached
// ---------------------------------------------------------------------------

/**
 * Look up a cached preview for the given ISBN in the current tenant's cache.
 *
 * @returns The cached partial BookRecord, or null on miss / expired.
 */
export async function getCached(
  tx: TxClient,
  tenantId: string,
  isbn13: string,
): Promise<Partial<BookRecord> | null> {
  const now = new Date();
  const rows = await tx
    .select()
    .from(isbnCache)
    .where(
      and(
        eq(isbnCache.tenantId, tenantId),
        eq(isbnCache.isbn13, isbn13),
        gt(isbnCache.expiresAt, now),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  return rows[0]?.payload as Partial<BookRecord>;
}

// ---------------------------------------------------------------------------
// putCached
// ---------------------------------------------------------------------------

/**
 * Upsert a preview into the ISBN cache for the current tenant.
 *
 * Uses ON CONFLICT (tenant_id, isbn13) DO UPDATE to ensure idempotency.
 * The UNIQUE index on (tenant_id, isbn13) must exist in the migration.
 *
 * @param ttlHours - How long the entry is valid (default 24 h per NFR-02-02).
 */
export async function putCached(
  tx: TxClient,
  tenantId: string,
  isbn13: string,
  payload: Partial<BookRecord>,
  ttlHours = 24,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await tx
    .insert(isbnCache)
    .values({
      tenantId,
      isbn13,
      payload: payload as Record<string, unknown>,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [isbnCache.tenantId, isbnCache.isbn13],
      set: {
        payload: sql`excluded.payload`,
        expiresAt: sql`excluded.expires_at`,
      },
    });
}
