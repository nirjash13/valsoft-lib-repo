import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { MemberNotFoundError } from "@/lib/domain/members/errors";
import { getMemberById } from "@/lib/domain/members/get-member-by-id";
import { notFound, redirect } from "next/navigation";
import { EditMemberForm } from "./edit-member-form";

interface EditMemberPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Member edit page (admin) — RSC (REQ-04-06, REQ-04-07, REQ-04-08).
 *
 * Permission gate: member:manage (tenant_admin only).
 * Librarians do not have member:manage — redirect to /members.
 *
 * Fetches the member row, then renders the client EditMemberForm.
 */
export default async function EditMemberPage({ params }: EditMemberPageProps) {
  const { id } = await params;

  const session = await requireSession();
  const tenantCtx = await sessionToTenantCtx(session);
  const ability = buildAbility(session.roles);

  if (!ability.can("manage", "Member")) {
    redirect("/members");
  }

  let member: Awaited<ReturnType<typeof getMemberById>>;
  try {
    member = await withTenantTx(tenantCtx, (tx) => getMemberById(tx, tenantCtx, id));
  } catch (err) {
    if (err instanceof MemberNotFoundError) notFound();
    throw err;
  }

  // Soft-deleted members cannot be edited
  if (member.deletedAt !== null) {
    notFound();
  }

  const canChangeRole = ability.can("manage", "Member");

  return (
    <div className="max-w-[720px] mx-auto">
      <h1 className="text-h1 text-text-primary mb-1">Edit member</h1>
      <p className="text-body text-text-secondary mb-8 truncate">
        {member.displayName} &middot; {member.email}
      </p>
      <EditMemberForm member={member} canChangeRole={canChangeRole} />
    </div>
  );
}
