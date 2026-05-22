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
    // 1. Fetch all books from active public catalogs, excluding blocked subjects
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
           AND b.subjects && t.public_catalog_subject_blocklist
         )
       ORDER BY b.updated_at DESC`,
    );

    // 2. Fetch all unique tenants with public catalogs enabled to index catalog homepages
    const tenantsRes = await client.query<{ slug: string }>(
      "SELECT slug FROM public.tenants WHERE public_catalog_enabled = true",
    );

    const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
    const sitemapEntries: MetadataRoute.Sitemap = [];

    // Add catalog index page for each tenant
    for (const t of tenantsRes.rows) {
      sitemapEntries.push({
        url: `${baseUrl}/${t.slug}/catalog`,
        lastModified: new Date(),
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
