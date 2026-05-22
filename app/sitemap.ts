import { getOwnerPool } from "@/lib/db/owner-pool";
import type { MetadataRoute } from "next";

export const revalidate = 60; // Cache sitemap at the edge for 60 seconds

/**
 * Global sitemap.xml generator (REQ-09-09).
 *
 * Runs unauthenticated and global (not tenant-scoped). Since it needs to look up
 * books across all tenants, we bypass RLS using the owner pool (BYPASSRLS)
 * rather than setting app.tenant_id.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pool = getOwnerPool();
  const client = await pool.connect();

  try {
    // 1. Fetch all books from active public catalogs, excluding blocked subjects.
    //    COALESCE(b.subjects, '{}') fixes the NULL-subjects bug (REQ-09-06):
    //    previously "NOT (blocklist != '{}' AND b.subjects && blocklist)" evaluated
    //    to NULL when b.subjects IS NULL, silently dropping those rows from the sitemap.
    //    With COALESCE the overlap check is always well-defined: NULL subjects → '{}' → no overlap.
    const booksRes = await client.query<{
      book_id: string;
      updated_at: Date;
      tenant_slug: string;
    }>(
      `SELECT
         b.id AS book_id,
         b.updated_at,
         t.slug AS tenant_slug
       FROM public.books b
       JOIN public.tenants t ON t.id = b.tenant_id
       WHERE t.public_catalog_enabled = true
         AND b.deleted_at IS NULL
         AND NOT (
           t.public_catalog_subject_blocklist != '{}'
           AND COALESCE(b.subjects, '{}') && t.public_catalog_subject_blocklist
         )
       ORDER BY b.updated_at DESC`,
    );

    // 2. Fetch tenants with public catalog enabled + MAX(updated_at) per tenant
    //    so catalog index entries use a meaningful lastModified (REQ-09-09).
    const tenantsRes = await client.query<{ slug: string; max_updated_at: Date | null }>(
      `SELECT t.slug, MAX(b.updated_at) AS max_updated_at
       FROM public.tenants t
       LEFT JOIN public.books b ON b.tenant_id = t.id AND b.deleted_at IS NULL
       WHERE t.public_catalog_enabled = true
       GROUP BY t.slug`,
    );

    const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
    const sitemapEntries: MetadataRoute.Sitemap = [];

    // Add catalog index page for each tenant (lastModified = MAX(book.updated_at))
    for (const t of tenantsRes.rows) {
      sitemapEntries.push({
        url: `${baseUrl}/${t.slug}/catalog`,
        lastModified: t.max_updated_at ?? new Date(),
        changeFrequency: "daily",
        priority: 0.8,
      });
    }

    // Add book detail page for each book
    for (const row of booksRes.rows) {
      sitemapEntries.push({
        url: `${baseUrl}/${row.tenant_slug}/catalog/${row.book_id}`,
        lastModified: row.updated_at,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }

    return sitemapEntries;
  } finally {
    client.release();
  }
}
