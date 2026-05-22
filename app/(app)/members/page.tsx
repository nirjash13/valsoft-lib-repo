import { Badge } from "@/components/ui/badge";
import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { listMembers } from "@/lib/domain/members/list-members";
import { Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

interface MembersPageProps {
  searchParams: Promise<{
    status?: string;
    cursor?: string;
  }>;
}

const ALLOWED_STATUSES = ["active", "pending", "rejected", "inactive", "suspended"] as const;
type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

function isAllowedStatus(s: string | undefined): s is AllowedStatus {
  return ALLOWED_STATUSES.includes(s as AllowedStatus);
}

/**
 * Member list — RSC (REQ-04-01, REQ-04-06).
 *
 * Permission gate: member:read (librarian + tenant_admin).
 * tenant_admin sees edit links + pending link; librarian sees read-only role column.
 */
export default async function MembersPage({ searchParams }: MembersPageProps) {
  const params = await searchParams;

  const session = await requireSession();
  const tenantCtx = await sessionToTenantCtx(session);
  const ability = buildAbility(session.roles);

  if (!ability.can("read", "Member")) {
    redirect("/books");
  }

  const canManageMembers = ability.can("manage", "Member");
  const canUpdateMembers = ability.can("update", "Member");

  // Pass null to listMembers when ?status is absent or "all" — shows all statuses.
  const statusFilter: AllowedStatus | null = isAllowedStatus(params.status)
    ? params.status
    : params.status === "all" || params.status === undefined
      ? null
      : "active";

  const { members, nextCursor } = await withTenantTx(tenantCtx, (tx) =>
    listMembers(tx, tenantCtx, {
      status: statusFilter, // null → all statuses
      cursor: params.cursor,
      limit: 20,
    }),
  );

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-h1 text-text-primary">Members</h1>
          <p className="text-meta text-text-secondary mt-1">
            {members.length} {statusFilter !== null ? `${statusFilter} ` : ""}
            member{members.length !== 1 ? "s" : ""}
          </p>
        </div>
        {canUpdateMembers && (
          <Link
            href="/members/pending"
            className="text-meta text-text-secondary hover:text-text-primary underline underline-offset-2 transition-colors"
          >
            Pending approvals
          </Link>
        )}
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {/* "All" tab — passes no status param, shows every status */}
        <Link
          href="/members"
          className={`text-caption px-3 py-1 rounded-full border transition-colors ${
            statusFilter === null
              ? // REVIEW: bg-[hsl(var(--accent)/0.12)] — opacity variant; needs oklch/rgb token to use Tailwind modifier
                "border-accent bg-[hsl(var(--accent)/0.12)] text-accent"
              : "border-border-subtle text-text-secondary hover:text-text-primary"
          }`}
        >
          All
        </Link>
        {ALLOWED_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/members?status=${s}`}
            className={`text-caption px-3 py-1 rounded-full border transition-colors ${
              s === statusFilter
                ? // REVIEW: bg-[hsl(var(--accent)/0.12)] — opacity variant; needs oklch/rgb token to use Tailwind modifier
                  "border-accent bg-[hsl(var(--accent)/0.12)] text-accent"
                : "border-border-subtle text-text-secondary hover:text-text-primary"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>

      {members.length === 0 ? (
        <EmptyState status={statusFilter} />
      ) : (
        <div className="rounded-xl border border-border-subtle overflow-hidden">
          <table className="w-full text-left border-collapse" aria-label="Members list">
            <thead className="bg-surface-2 border-b border-border-subtle">
              <tr>
                <th scope="col" className="px-4 py-3 text-caption text-text-tertiary font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 text-caption text-text-tertiary font-medium">
                  Email
                </th>
                <th scope="col" className="px-4 py-3 text-caption text-text-tertiary font-medium">
                  Role
                </th>
                <th scope="col" className="px-4 py-3 text-caption text-text-tertiary font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 text-caption text-text-tertiary font-medium">
                  Can borrow
                </th>
                <th scope="col" className="px-4 py-3 text-caption text-text-tertiary font-medium">
                  Joined
                </th>
                {canManageMembers && (
                  <th
                    scope="col"
                    className="px-4 py-3 text-caption text-text-tertiary font-medium text-right"
                  >
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr
                  key={member.id}
                  className="border-b border-border-subtle last:border-0 hover:bg-elevated transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="text-body font-medium text-text-primary">
                      {member.displayName}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-body text-text-secondary">{member.email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={member.role} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={member.status} />
                  </td>
                  <td className="px-4 py-3 text-body text-text-secondary">
                    {member.canBorrow ? "Yes" : "No"}
                  </td>
                  <td className="px-4 py-3 text-body text-text-secondary">
                    {formatDate(member.createdAt)}
                  </td>
                  {canManageMembers && (
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/members/${member.id}/edit`}
                        className="text-meta text-accent hover:underline underline-offset-2"
                      >
                        Edit
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {nextCursor && (
        <div className="mt-8 flex justify-center gap-6">
          <Link
            href={
              statusFilter !== null
                ? `/members?status=${statusFilter}&cursor=${encodeURIComponent(nextCursor)}`
                : `/members?cursor=${encodeURIComponent(nextCursor)}`
            }
            className="text-body text-text-secondary hover:text-text-primary underline underline-offset-2"
          >
            Next page
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState({ status }: { status: string | null }) {
  const label = status ?? "matching";
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "hsl(212 40% 18%)" }}
        aria-hidden
      >
        <Users className="h-8 w-8 text-accent" />
      </div>
      <p className="text-h3 text-text-primary mb-2">No {label} members</p>
      <p className="text-body text-text-secondary">
        {status !== null ? `Members with ${status} status will appear here.` : "No members found."}
      </p>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (role === "tenant_admin") return <Badge variant="default">Admin</Badge>;
  if (role === "librarian") return <Badge variant="secondary">Librarian</Badge>;
  return <Badge variant="secondary">Member</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge variant="success">Active</Badge>;
  if (status === "pending") return <Badge variant="warning">Pending</Badge>;
  if (status === "rejected") return <Badge variant="danger">Rejected</Badge>;
  if (status === "inactive") return <Badge variant="secondary">Inactive</Badge>;
  if (status === "suspended") return <Badge variant="danger">Suspended</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { dateStyle: "medium" });
}
