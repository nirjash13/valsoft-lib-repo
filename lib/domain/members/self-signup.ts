/**
 * selfSignup — creates a member row in 'pending' status.
 *
 * Called from app/api/members/signup/route.ts (a public Route Handler).
 * NOT called from a Server Action because next-safe-action's actionClient
 * requires an authenticated session; self-signup is pre-auth.
 *
 * Tenant context: the tenantId is resolved from the request hostname by the
 * Route Handler using resolveTenantIdBySlug() — it is NOT caller-supplied.
 *
 * The auth0_user_id field is NOT set here. The Auth0 invitation is sent on
 * approval (REQ-04-04). When the invited user accepts the invitation and logs in
 * for the first time, the Auth0 Post-Login Action writes their sub back to
 * members.auth0_user_id via a Management API callback (Run B / Spec 07).
 *
 * REQ-04-02: email uniqueness is enforced by a case-insensitive unique index
 * (members_tenant_email_lower_idx from 0006_circulation.sql) and the Drizzle
 * unique constraint. A constraint violation is caught and rethrown as
 * MemberAlreadyExistsError to avoid leaking PG error detail to the client.
 */

import { writeAuditLog } from "@/lib/audit/audit-log";
import type { Member } from "@/lib/db/schema/members";
import { members } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import { canBorrow } from "./can-borrow";
import { MemberAlreadyExistsError } from "./errors";
import type { SelfSignupInput } from "./schemas";

export interface SelfSignupResult {
  member: Member;
}

/**
 * @throws MemberAlreadyExistsError if the email is already registered in this tenant.
 */
export async function selfSignup(
  tx: TxClient,
  ctx: TenantCtx,
  input: Omit<SelfSignupInput, "agreedToTerms">,
): Promise<SelfSignupResult> {
  // Compute initial canBorrow: pending members cannot borrow.
  const initialStatus = "pending" as const;
  const initialCanBorrow = canBorrow({ status: initialStatus });

  let member: Member;

  try {
    const [inserted] = await tx
      .insert(members)
      .values({
        tenantId: ctx.tenantId,
        displayName: input.displayName,
        email: input.email.toLowerCase(), // normalise to lower for consistent lookup
        phone: input.phone ?? null,
        status: initialStatus,
        role: "member",
        canBorrow: initialCanBorrow,
      })
      .returning();

    // biome-ignore lint/style/noNonNullAssertion: INSERT … RETURNING always returns exactly one row
    member = inserted!;
  } catch (err) {
    // Postgres unique violation error code: 23505
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException & { code: string }).code === "23505"
    ) {
      throw new MemberAlreadyExistsError("email");
    }
    throw err;
  }

  await writeAuditLog(tx, ctx, {
    action: "member.self_signed_up",
    subjectType: "member",
    subjectId: member.id,
    afterJson: {
      displayName: member.displayName,
      email: member.email,
      status: member.status,
    },
  });

  return { member };
}
