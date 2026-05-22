/**
 * Settings Server Actions — tenant configuration commands.
 *
 * updateBrandVoiceAction      — tenant_admin only (tenant:settings).
 * updatePublicCatalogAction   — tenant_admin only (tenant:settings). US-05, REQ-09-05.
 *
 * Updates tenant-level settings for the calling user's tenant.
 */

"use server";

import { writeAuditLog } from "@/lib/audit/audit-log";
import { actionClient } from "@/lib/auth/safe-action";
import { tenants } from "@/lib/db/schema/tenants";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { invalidateTenantCatalogCache } from "@/lib/domain/catalog/resolve-tenant-by-slug";
import { UpdateBrandVoiceSchema, UpdatePublicCatalogSchema } from "@/lib/domain/settings/schemas";
import { eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";

/**
 * Updates the tenant's brand voice setting.
 *
 * Gated on `tenant:settings` — only tenant_admin holds this permission.
 *
 * @permission tenant:settings
 */
export const updateBrandVoiceAction = actionClient
  .schema(UpdateBrandVoiceSchema)
  .metadata({ permission: "tenant:settings" })
  .action(async ({ parsedInput, ctx }) => {
    const { brandVoice } = parsedInput;
    const tenantId = ctx.tenantCtx.tenantId;

    await withTenantTx(ctx.tenantCtx, async (tx, txCtx) => {
      await tx.update(tenants).set({ brandVoice }).where(eq(tenants.id, txCtx.tenantId));
    });

    // Invalidate the tenant settings cache tag.
    revalidateTag(`tenant:${tenantId}:settings`, "default");

    return { brandVoice };
  });

/**
 * Toggles the public catalog on or off for the calling user's tenant.
 *
 * Side effects (REQ-09-05):
 *   - Updates tenants.public_catalog_enabled in the DB (in-tx audit log).
 *   - Invalidates the per-process slug cache so the change takes effect immediately.
 *   - Revalidates the sitemap and catalog layout so ISR pages reflect the change.
 *
 * Gated on `tenant:settings` — only tenant_admin holds this permission.
 *
 * @permission tenant:settings
 */
export const updatePublicCatalogAction = actionClient
  .schema(UpdatePublicCatalogSchema)
  .metadata({ permission: "tenant:settings" })
  .action(async ({ parsedInput, ctx }) => {
    const { enabled } = parsedInput;
    const { tenantCtx } = ctx;

    let tenantSlug: string | null = null;

    await withTenantTx(tenantCtx, async (tx, txCtx) => {
      // Fetch current value for audit before-state, and resolve slug for cache invalidation.
      const [existing] = await tx
        .select({ publicCatalogEnabled: tenants.publicCatalogEnabled, slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, txCtx.tenantId));

      tenantSlug = existing?.slug ?? null;

      await tx
        .update(tenants)
        .set({ publicCatalogEnabled: enabled })
        .where(eq(tenants.id, txCtx.tenantId));

      await writeAuditLog(tx, txCtx, {
        action: "tenant.public_catalog_toggled",
        subjectType: "tenant",
        subjectId: txCtx.tenantId,
        beforeJson: { publicCatalogEnabled: existing?.publicCatalogEnabled ?? null },
        afterJson: { publicCatalogEnabled: enabled },
      });
    });

    // Bust the per-process slug cache so the next request sees the new state (REQ-09-05).
    if (tenantSlug !== null) {
      invalidateTenantCatalogCache(tenantSlug);
      // Revalidate ISR catalog pages and sitemap (REQ-09-05).
      revalidatePath(`/${tenantSlug}/catalog`, "layout");
    }
    revalidatePath("/sitemap.xml");

    return { enabled };
  });
