import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { getMemberByUserId } from "@/lib/domain/members/get-member-by-user-id";
import { EditProfileForm } from "./edit-profile-form";

/**
 * Profile self-edit page (REQ-04-09).
 *
 * Any authenticated member. No CASL gate beyond requireSession because
 * member:update is granted to all roles (ownership check is inside the domain fn).
 *
 * If no member row is linked to the Auth0 sub yet, shows an "account not linked"
 * placeholder (same pattern as loans page).
 */
export default async function MyProfilePage() {
  const session = await requireSession();
  const tenantCtx = await sessionToTenantCtx(session);
  const ability = buildAbility(session.roles);

  const member = await withTenantTx(tenantCtx, (tx) =>
    getMemberByUserId(tx, tenantCtx, session.sub),
  );

  if (!member) {
    return (
      <div className="max-w-[720px] mx-auto">
        <h1 className="text-h1 text-text-primary mb-6">My profile</h1>
        <div className="rounded-xl border border-border-subtle bg-surface p-6">
          <p className="text-body text-text-secondary mb-2">
            Your member account is not yet linked to your login.
          </p>
          <p className="text-meta text-text-tertiary">
            Contact your librarian to link your account.
          </p>
        </div>
      </div>
    );
  }

  // Permission: any auth'd user can read their own profile.
  // The updateMemberAction enforces ownership server-side.
  const canEdit = ability.can("update", "Member");

  return (
    <div className="max-w-[720px] mx-auto">
      <h1 className="text-h1 text-text-primary mb-1">My profile</h1>
      <p className="text-body text-text-secondary mb-8">
        Update your display name and contact information.
      </p>

      {canEdit ? (
        <EditProfileForm member={member} />
      ) : (
        /* Read-only view for members without update permission */
        <div className="rounded-xl border border-border-subtle bg-surface p-5 space-y-4">
          <div>
            <p className="text-caption text-text-tertiary mb-0.5">Name</p>
            <p className="text-body text-text-primary">{member.displayName}</p>
          </div>
          <div>
            <p className="text-caption text-text-tertiary mb-0.5">Email</p>
            <p className="text-body text-text-primary">{member.email}</p>
          </div>
          {member.phone && (
            <div>
              <p className="text-caption text-text-tertiary mb-0.5">Phone</p>
              <p className="text-body text-text-primary">{member.phone}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
