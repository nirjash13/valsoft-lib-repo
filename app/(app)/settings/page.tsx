/**
 * Settings page — tenant configuration (tenant_admin only).
 *
 * US-06: admin can view and change the brand voice (warm / formal / academic)
 * that AI draft mode uses when composing patron batch emails.
 *
 * Gated on tenant:settings CASL permission (tenant_admin only).
 */

import { BrandVoiceForm } from "@/components/settings/brand-voice-form";
import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { tenants } from "@/lib/db/schema/tenants";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import type { BrandVoice } from "@/lib/domain/settings/schemas";
import { eq } from "drizzle-orm";

export const metadata = {
  title: "Settings — Stack",
};

const DEFAULT_BRAND_VOICE: BrandVoice = "warm";

export default async function SettingsPage() {
  const session = await requireSession();
  const ability = buildAbility(session.roles);

  if (!ability.can("settings", "Tenant")) {
    return (
      <div className="flex flex-col gap-2 py-16 text-center">
        <p className="text-text-primary font-semibold">Access restricted</p>
        <p className="text-sm text-text-tertiary">
          Only tenant administrators can access settings.
        </p>
      </div>
    );
  }

  const tenantCtx = await sessionToTenantCtx(session);

  const currentBrandVoice = await withTenantTx(tenantCtx, async (tx, txCtx) => {
    const [tenantRow] = await tx
      .select({ brandVoice: tenants.brandVoice })
      .from(tenants)
      .where(eq(tenants.id, txCtx.tenantId));
    return (tenantRow?.brandVoice as BrandVoice | null) ?? DEFAULT_BRAND_VOICE;
  });

  return (
    <div className="space-y-8 max-w-2xl">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">Settings</h1>
        <p className="mt-1 text-sm text-text-tertiary">
          Configure your library's tenant preferences.
        </p>
      </header>

      {/* Brand voice */}
      <section aria-labelledby="brand-voice-heading">
        <h2 id="brand-voice-heading" className="text-h3 font-semibold text-text-primary mb-1">
          AI email tone
        </h2>
        <p className="text-sm text-text-tertiary mb-4">
          Controls the tone the AI uses when drafting batch patron emails (US-06).
        </p>
        <div className="rounded-lg border border-border-subtle bg-surface p-6">
          <BrandVoiceForm currentBrandVoice={currentBrandVoice} />
        </div>
      </section>
    </div>
  );
}
