/**
 * Book management Server Actions — the command bus for Spec 02 CRUD.
 *
 * Pattern: actionClient.schema(…).metadata({ permission }).action(async ({ parsedInput, ctx }) =>
 *   withTenantTx(ctx.tenantCtx, async (tx, txCtx) => domainFn(tx, txCtx, parsedInput))
 * )
 *
 * Cache invalidation: every mutation calls revalidateTag(`tenant:${tenantId}:books`)
 * so RSC list pages and detail pages reflect changes immediately.
 *
 * No HTTP work inside actions. Side effects (audit log, cache invalidation) are
 * handled inside the domain function or immediately after it returns.
 */

"use server";

import { actionClient } from "@/lib/auth/safe-action";
import { getOwnerPool } from "@/lib/db/owner-pool";
import type { TenantId } from "@/lib/db/schema/_shared";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { createBook } from "@/lib/domain/books/create-book";
import { previewIsbn } from "@/lib/domain/books/preview-isbn";
import { restoreBook } from "@/lib/domain/books/restore-book";
import {
  CreateBookSchema,
  PreviewIsbnSchema,
  RestoreBookSchema,
  SoftDeleteBookSchema,
  UpdateBookSchema,
} from "@/lib/domain/books/schemas";
import { softDeleteBook } from "@/lib/domain/books/soft-delete-book";
import { updateBook } from "@/lib/domain/books/update-book";
import { revalidatePath, revalidateTag } from "next/cache";

// ---------------------------------------------------------------------------
// previewIsbn — ai:use_enrich permission (librarian/admin only — triggers external
// API fan-out and optionally spends tenant AI budget via assertAiBudget)
// ---------------------------------------------------------------------------

/**
 * Fetches enriched book metadata for an ISBN without writing to the DB.
 * Returns a preview record for the librarian to confirm / edit before saving.
 *
 * @permission ai:use_enrich
 */
export const previewIsbnAction = actionClient
  .schema(PreviewIsbnSchema)
  .metadata({ permission: "ai:use_enrich" })
  .action(async ({ parsedInput, ctx }) => {
    return withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      return previewIsbn(tx, txCtx.tenantId as TenantId, parsedInput.rawIsbn);
    });
  });

// ---------------------------------------------------------------------------
// createBook — book:create
// ---------------------------------------------------------------------------

/**
 * Inserts a book row and writes an audit_log row atomically.
 * The input is the confirmed (possibly edited) preview data from previewIsbn.
 *
 * @permission book:create
 */
export const createBookAction = actionClient
  .schema(CreateBookSchema)
  .metadata({ permission: "book:create" })
  .action(async ({ parsedInput, ctx }) => {
    const result = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      return createBook(tx, txCtx, parsedInput);
    });

    revalidateTag(`tenant:${ctx.tenantCtx.tenantId}:books`, "default");

    try {
      const pool = getOwnerPool();
      const res = await pool.query<{ slug: string }>(
        "SELECT slug FROM tenants WHERE id = $1 LIMIT 1",
        [ctx.tenantCtx.tenantId],
      );
      const slug = res.rows[0]?.slug;
      if (slug) {
        revalidatePath(`/${slug}/catalog`);
        revalidatePath(`/${slug}/catalog/${result.id}`);
        revalidatePath("/sitemap.xml");
      }
    } catch (err) {
      console.warn("[revalidate] Failed to revalidate public pages on create:", err);
    }

    return result;
  });

// ---------------------------------------------------------------------------
// updateBook — book:update
// ---------------------------------------------------------------------------

/**
 * Updates a book's fields with optimistic concurrency protection.
 * Returns 409 Conflict if updated_at has changed since the client last loaded.
 *
 * @permission book:update
 */
export const updateBookAction = actionClient
  .schema(UpdateBookSchema)
  .metadata({ permission: "book:update" })
  .action(async ({ parsedInput, ctx }) => {
    const result = await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      return updateBook(tx, txCtx, parsedInput);
    });

    revalidateTag(`tenant:${ctx.tenantCtx.tenantId}:books`, "default");

    try {
      const pool = getOwnerPool();
      const res = await pool.query<{ slug: string }>(
        "SELECT slug FROM tenants WHERE id = $1 LIMIT 1",
        [ctx.tenantCtx.tenantId],
      );
      const slug = res.rows[0]?.slug;
      if (slug) {
        revalidatePath(`/${slug}/catalog`);
        revalidatePath(`/${slug}/catalog/${result.id}`);
        revalidatePath("/sitemap.xml");
      }
    } catch (err) {
      console.warn("[revalidate] Failed to revalidate public pages on update:", err);
    }

    return result;
  });

// ---------------------------------------------------------------------------
// softDeleteBook — book:delete
// ---------------------------------------------------------------------------

/**
 * Soft-deletes a book by setting deleted_at = NOW().
 * Refused if the book has an active loan (Spec 03 stub: never refused in Run A).
 *
 * @permission book:delete
 */
export const softDeleteBookAction = actionClient
  .schema(SoftDeleteBookSchema)
  .metadata({ permission: "book:delete" })
  .action(async ({ parsedInput, ctx }) => {
    await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      await softDeleteBook(tx, txCtx, parsedInput.id);
    });

    revalidateTag(`tenant:${ctx.tenantCtx.tenantId}:books`, "default");

    try {
      const pool = getOwnerPool();
      const res = await pool.query<{ slug: string }>(
        "SELECT slug FROM tenants WHERE id = $1 LIMIT 1",
        [ctx.tenantCtx.tenantId],
      );
      const slug = res.rows[0]?.slug;
      if (slug) {
        revalidatePath(`/${slug}/catalog`);
        revalidatePath(`/${slug}/catalog/${parsedInput.id}`);
        revalidatePath("/sitemap.xml");
      }
    } catch (err) {
      console.warn("[revalidate] Failed to revalidate public pages on delete:", err);
    }

    return { deleted: true };
  });

// ---------------------------------------------------------------------------
// restoreBook — book:delete (admin can restore, same gate as delete)
// ---------------------------------------------------------------------------

/**
 * Restores a soft-deleted book within the 30-day retention window.
 * Returns 404 if not found, not deleted, or past the retention window.
 *
 * @permission book:delete
 */
export const restoreBookAction = actionClient
  .schema(RestoreBookSchema)
  .metadata({ permission: "book:delete" })
  .action(async ({ parsedInput, ctx }) => {
    await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      await restoreBook(tx, txCtx, parsedInput.id);
    });

    revalidateTag(`tenant:${ctx.tenantCtx.tenantId}:books`, "default");

    try {
      const pool = getOwnerPool();
      const res = await pool.query<{ slug: string }>(
        "SELECT slug FROM tenants WHERE id = $1 LIMIT 1",
        [ctx.tenantCtx.tenantId],
      );
      const slug = res.rows[0]?.slug;
      if (slug) {
        revalidatePath(`/${slug}/catalog`);
        revalidatePath(`/${slug}/catalog/${parsedInput.id}`);
        revalidatePath("/sitemap.xml");
      }
    } catch (err) {
      console.warn("[revalidate] Failed to revalidate public pages on restore:", err);
    }

    return { restored: true };
  });
