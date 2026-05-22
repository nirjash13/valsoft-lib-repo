/**
 * Settings Server Actions — tenant configuration commands.
 *
 * updateBrandVoiceAction — tenant_admin only (tenant:settings).
 * Updates tenants.brand_voice for the calling user's tenant.
 *
 * US-06: tenant admin can set brand voice that AI draft mode respects.
 */

"use server";

import { actionClient } from "@/lib/auth/safe-action";
import { tenants } from "@/lib/db/schema/tenants";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { UpdateBrandVoiceSchema } from "@/lib/domain/settings/schemas";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";

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
