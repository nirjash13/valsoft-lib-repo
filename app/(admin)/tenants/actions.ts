/**
 * Tenant provisioning Server Action.
 *
 * Only `system_owner` role can call this (gated by metadata.permission = "tenant:provision").
 *
 * REQ-01-09: "create the Auth0 Organization, insert a tenants row, seed default roles,
 * create the first tenant-admin invitation, and report any partial failure with a rollback prompt."
 *
 * Auth0 Organization creation:
 *   Creating the Auth0 Org via the Management API is a separate concern that happens
 *   OUTSIDE the DB transaction — Auth0 is not transactional with Postgres. In this run:
 *   - We assume the Auth0 Org already exists (created in the Auth0 dashboard or a separate
 *     Management API call initiated by the UI before invoking this action).
 *   - We record the `auth0_org_id` that the caller supplies.
 *   - If the DB insert fails after the Auth0 Org was created, the UI receives an error
 *     and can surface a "retry / cleanup" flow (REQ-01-09 rollback prompt pattern).
 *   Run C will add the Management API call with a two-phase commit guard.
 *
 * WHY withSystemOwnerTx (not withTenantTx):
 *   Tenant provisioning inserts into `tenants` before the new tenant_id exists in
 *   `tenant_memberships`. The stack_app role's RLS on `tenants` (after migration 0003)
 *   would reject the INSERT because app.user_id is not yet a member of the new tenant.
 *   withSystemOwnerTx uses the owner connection (BYPASSRLS) and sets app.system_owner=true
 *   so the operator-mode RLS policy allows the write. See lib/db/with-system-owner-tx.ts.
 */

"use server";

import { type AuditOverride, writeSystemAuditLog } from "@/lib/audit/audit-log";
import { actionClient } from "@/lib/auth/safe-action";
import type { TenantId, UserId } from "@/lib/auth/types";
import { tenantMemberships } from "@/lib/db/schema/tenant-memberships";
import { tenants } from "@/lib/db/schema/tenants";
import { withSystemOwnerTx } from "@/lib/db/with-system-owner-tx";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const ProvisionTenantSchema = z.object({
  /** Human-readable library name. */
  name: z.string().min(1).max(100),
  /** URL-safe slug, used as subdomain / public catalog path. */
  slug: z
    .string()
    .regex(/^[a-z0-9-]{3,40}$/, "Slug must be 3–40 lowercase letters, digits, or hyphens"),
  /** Auth0 Organization id (org_xxx…). Already created in Auth0. */
  auth0OrgId: z.string().min(1),
  /** Optional monthly AI spend cap in USD. Defaults to $50. */
  aiMonthlyCapUsd: z.number().positive().optional(),
  /** Default loan duration in days. Defaults to 14. */
  loanDurationDays: z.number().int().positive().optional(),
  /**
   * Auth0 user_id of the first tenant_admin.
   * This user will be inserted into `tenant_memberships` with role `tenant_admin`.
   */
  firstAdminUserId: z.string().min(1),
});

type ProvisionTenantInput = z.infer<typeof ProvisionTenantSchema>;

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

/**
 * Provisions a new tenant (library) in the database.
 *
 * Steps (all in one DB transaction — atomic rollback on any failure):
 *   1. Insert into `tenants`
 *   2. Insert first `tenant_memberships` row with role `tenant_admin`
 *   3. Write `audit_log` row with action="tenant.provisioned"
 *
 * Returns `{ tenantId }` on success — the new tenant's UUID.
 *
 * @permission tenant:provision — system_owner only
 */
export const provisionTenant = actionClient
  .schema(ProvisionTenantSchema)
  .metadata({ permission: "tenant:provision" })
  .action(async ({ parsedInput, ctx }) => {
    const input: ProvisionTenantInput = parsedInput;

    const result = await withSystemOwnerTx(async (tx) => {
      // Step 1: Insert tenant row
      const [newTenant] = await tx
        .insert(tenants)
        .values({
          auth0OrgId: input.auth0OrgId,
          name: input.name,
          slug: input.slug,
          ...(input.aiMonthlyCapUsd !== undefined && {
            aiMonthlyCapUsd: String(input.aiMonthlyCapUsd),
          }),
          ...(input.loanDurationDays !== undefined && {
            loanDurationDays: input.loanDurationDays,
          }),
        })
        .returning({ id: tenants.id });

      if (!newTenant) {
        throw new Error("Tenant insert returned no row — unexpected DB state");
      }

      const tenantId = newTenant.id;

      // Step 2: Insert the first tenant_admin membership
      await tx.insert(tenantMemberships).values({
        tenantId,
        userId: input.firstAdminUserId,
        role: "tenant_admin",
        status: "active",
      });

      // Step 3: Write audit log via writeSystemAuditLog.
      // We use writeSystemAuditLog (not writeAuditLog) because the ctx carries the
      // operator's session (system_owner), not the newly created tenant's context.
      // The audit row must be attributed to the new tenant (tenantId) and the operator
      // (ctx.session.sub). The override is constructed from trusted internal state:
      // tenantId from the DB insert return, actorId from the verified session.
      const auditOverride: AuditOverride = {
        tenantId: tenantId as TenantId,
        actorId: ctx.session.sub as UserId,
      };
      await writeSystemAuditLog(tx, auditOverride, {
        action: "tenant.provisioned",
        subjectType: "tenant",
        subjectId: tenantId,
        afterJson: {
          name: input.name,
          slug: input.slug,
          auth0OrgId: input.auth0OrgId,
          firstAdminUserId: input.firstAdminUserId,
        },
      });

      return { tenantId };
    });

    return result;
  });
