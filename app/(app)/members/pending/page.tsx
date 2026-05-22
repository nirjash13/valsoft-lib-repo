import { ApproveButton } from "@/components/members/approve-button";
import { RejectButton } from "@/components/members/reject-button";
import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { listPendingMembers } from "@/lib/domain/members/list-pending-members";
import { Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

interface PendingPageProps {
  searchParams: Promise<{ cursor?: string }>;
}

/**
 * Approval queue — RSC (REQ-04-03, REQ-04-04).
 *
 * Permission gate: member:update (librarian + tenant_admin).
 * Lists pending signups oldest-first. Approve/Reject client buttons inline.
 */
export default async function PendingMembersPage({ searchParams }: PendingPageProps) {
  const params = await searchParams;

  const session = await requireSession();
  const tenantCtx = await sessionToTenantCtx(session);
  const ability = buildAbility(session.roles);

  if (!ability.can("update", "Member")) {
    redirect("/members");
  }

  const { members, nextCursor } = await withTenantTx(tenantCtx, (tx) =>
    listPendingMembers(tx, tenantCtx, {
      cursor: params.cursor,
      limit: 20,
    }),
  );

  return (
    <div className="max-w-[900px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-h1 text-text-primary">Pending applications</h1>
          <p className="text-meta text-text-secondary mt-1">
            {members.length} application{members.length !== 1 ? "s" : ""} awaiting review
          </p>
        </div>
        <Link
          href="/members"
          className="text-meta text-text-secondary hover:text-text-primary underline underline-offset-2 transition-colors"
        >
          All members
        </Link>
      </div>

      {members.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3 list-none p-0 m-0">
          {members.map((member) => (
            <li key={member.id} className="rounded-xl border border-border-subtle bg-surface p-4">
              <div className="flex items-start justify-between gap-4">
                {/* Avatar + info */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-body font-medium text-accent-text"
                    style={{ background: "hsl(var(--accent))" }}
                    aria-hidden
                  >
                    {member.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-body font-medium text-text-primary truncate">
                      {member.displayName}
                    </p>
                    <p className="text-meta text-text-secondary truncate">{member.email}</p>
                    {member.phone && (
                      <p className="text-caption text-text-tertiary">{member.phone}</p>
                    )}
                    <p className="text-caption text-text-tertiary mt-0.5">
                      Applied {formatRelative(member.createdAt)}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 shrink-0">
                  <ApproveButton
                    memberId={member.id}
                    expectedUpdatedAt={member.updatedAt.toISOString()}
                  />
                  <RejectButton
                    memberId={member.id}
                    expectedUpdatedAt={member.updatedAt.toISOString()}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="mt-8 flex justify-center">
          <Link
            href={`/members/pending?cursor=${encodeURIComponent(nextCursor)}`}
            className="text-body text-text-secondary hover:text-text-primary underline underline-offset-2"
          >
            Next page
          </Link>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "hsl(212 40% 18%)" }}
        aria-hidden
      >
        <Users className="h-8 w-8 text-accent" />
      </div>
      <p className="text-h3 text-text-primary mb-2">No pending applications</p>
      <p className="text-body text-text-secondary">
        New member requests will appear here for review.
      </p>
    </div>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { dateStyle: "medium" });
}
