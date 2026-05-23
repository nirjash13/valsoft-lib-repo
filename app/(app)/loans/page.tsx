import { RenewButton } from "@/components/circulation/renew-button";
import { ReturnButton } from "@/components/circulation/return-button";
import { Badge } from "@/components/ui/badge";
import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { listActiveLoans } from "@/lib/domain/loans/list-active-loans";
import { listLoansByMember } from "@/lib/domain/loans/list-loans-by-member";
import { getMemberByUserId } from "@/lib/domain/members/get-member-by-user-id";
import { BookOpen } from "lucide-react";
import Link from "next/link";

interface LoansPageProps {
  searchParams: Promise<{ overdue?: string; page?: string }>;
}

/**
 * Loans page — RSC query. Role-aware (REQ-03-07, REQ-03-08, REQ-03-10).
 *
 * Librarians / tenant_admin: paginated table of all active loans, overdue filter,
 * return button per row.
 *
 * Members: list of their own active loans with due dates, overdue badge, and
 * renewal eligibility. Renew button shown only when the user has loan:update
 * permission (librarian/admin must renew on behalf of members until self-service
 * is enabled). Member view requires auth0_user_id linkage (Spec 04).
 */
export default async function LoansPage({ searchParams }: LoansPageProps) {
  const params = await searchParams;
  const overdueOnly = params.overdue === "1";
  const page = Math.max(1, Number(params.page ?? 1));
  const perPage = 50;
  const offset = (page - 1) * perPage;

  const session = await requireSession();
  const tenantCtx = await sessionToTenantCtx(session);
  const ability = buildAbility(session.roles);

  const canReadAllLoans = ability.can("manage", "Loan") || ability.can("checkin", "Loan");
  const canReturn = ability.can("update", "Loan");
  const canRenewAction = ability.can("update", "Loan");

  if (canReadAllLoans) {
    // Librarian / admin view: paginated list of all active loans.
    const loans = await withTenantTx(tenantCtx, (tx) =>
      listActiveLoans(tx, tenantCtx, { overdueOnly, limit: perPage, offset }),
    );

    return (
      <div className="max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-h1 text-text-primary">Active Loans</h1>
            <p className="text-meta text-text-secondary mt-1">
              {loans.length} active loan{loans.length !== 1 ? "s" : ""}
              {overdueOnly ? " — overdue only" : ""}
            </p>
          </div>

          {/* Overdue filter toggle */}
          <Link
            href={overdueOnly ? "/loans" : "/loans?overdue=1"}
            className="text-meta text-text-secondary hover:text-text-primary transition-instant transition-colors underline-offset-2 hover:underline"
          >
            {overdueOnly ? "Show all loans" : "Show overdue only"}
          </Link>
        </div>

        {loans.length === 0 ? (
          <LibrarianEmptyState overdueOnly={overdueOnly} />
        ) : (
          <div className="rounded-xl border border-border-subtle overflow-hidden">
            <table className="w-full text-left border-collapse" aria-label="Active loans">
              <thead className="bg-surface-2 border-b border-border-subtle">
                <tr>
                  <th scope="col" className="px-4 py-3 text-caption text-text-tertiary font-medium">
                    Book
                  </th>
                  <th scope="col" className="px-4 py-3 text-caption text-text-tertiary font-medium">
                    Member
                  </th>
                  <th scope="col" className="px-4 py-3 text-caption text-text-tertiary font-medium">
                    Due Date
                  </th>
                  <th scope="col" className="px-4 py-3 text-caption text-text-tertiary font-medium">
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-caption text-text-tertiary font-medium text-right"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => (
                  <tr
                    key={loan.id}
                    className="border-b border-border-subtle last:border-0 hover:bg-elevated transition-instant transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/books/${loan.bookId}`}
                        className="text-accent hover:underline underline-offset-2"
                      >
                        <span className="text-body font-medium">{loan.bookTitle}</span>
                        {loan.bookAuthors.length > 0 && (
                          <span className="text-meta text-text-tertiary ml-2">
                            {loan.bookAuthors.join(", ")}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-body text-text-primary">{loan.memberDisplayName}</div>
                      <div className="text-meta text-text-tertiary">{loan.memberEmail}</div>
                    </td>
                    <td className="px-4 py-3 text-body text-text-secondary">
                      {formatDate(loan.dueAt)}
                    </td>
                    <td className="px-4 py-3">
                      {loan.isOverdue ? (
                        <Badge variant="danger">Overdue</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {canReturn && <ReturnButton loanId={loan.id} bookTitle={loan.bookTitle} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {loans.length === perPage && (
          <div className="mt-8 flex justify-center gap-6">
            {page > 1 && (
              <Link
                href={`/loans?overdue=${overdueOnly ? 1 : 0}&page=${page - 1}`}
                className="text-body text-text-secondary hover:text-text-primary underline underline-offset-2"
              >
                Previous
              </Link>
            )}
            <Link
              href={`/loans?overdue=${overdueOnly ? 1 : 0}&page=${page + 1}`}
              className="text-body text-text-secondary hover:text-text-primary underline underline-offset-2"
            >
              Next page
            </Link>
          </div>
        )}
      </div>
    );
  }

  // Member view: own loans only.
  // Requires auth0_user_id linkage (Spec 04). Until then, show a setup message.
  const member = await withTenantTx(tenantCtx, (tx) =>
    getMemberByUserId(tx, tenantCtx, session.sub),
  );

  if (!member) {
    return (
      <div className="max-w-[800px] mx-auto">
        <h1 className="text-h1 text-text-primary mb-2">My Loans</h1>
        <MemberAccountPending />
      </div>
    );
  }

  const loans = await withTenantTx(tenantCtx, (tx) => listLoansByMember(tx, tenantCtx, member.id));

  return (
    <div className="max-w-[800px] mx-auto">
      <div className="mb-6">
        <h1 className="text-h1 text-text-primary">My Loans</h1>
        <p className="text-meta text-text-secondary mt-1">
          {loans.length} active loan{loans.length !== 1 ? "s" : ""}
        </p>
      </div>

      {loans.length === 0 ? (
        <MemberEmptyState />
      ) : (
        <ul className="space-y-3 list-none p-0 m-0">
          {loans.map((loan) => (
            <li
              key={loan.id}
              className="rounded-xl border border-border-subtle bg-surface p-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Link
                    href={`/books/${loan.bookId}`}
                    className="text-body font-medium text-text-primary hover:underline underline-offset-2 truncate"
                  >
                    {loan.bookTitle}
                  </Link>
                  {loan.isOverdue ? (
                    <Badge variant="danger">Overdue</Badge>
                  ) : (
                    <Badge variant="success">Active</Badge>
                  )}
                </div>
                {loan.bookAuthors.length > 0 && (
                  <p className="text-meta text-text-tertiary">by {loan.bookAuthors.join(", ")}</p>
                )}
                <p className="text-meta text-text-secondary">
                  Due {formatDate(loan.dueAt)}
                  {loan.renewedCount > 0 && ` · Renewed ${loan.renewedCount}×`}
                </p>
                {!loan.canRenew && (
                  <p className="text-caption text-text-tertiary mt-0.5">Renewal not available</p>
                )}
              </div>

              <div className="shrink-0">
                {canRenewAction && (
                  <RenewButton
                    loanId={loan.id}
                    expectedUpdatedAt={loan.updatedAt.toISOString()}
                    canRenew={loan.canRenew}
                    blockedReason={
                      loan.canRenew
                        ? undefined
                        : "Renewal limit reached or another member is waiting"
                    }
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LibrarianEmptyState({ overdueOnly }: { overdueOnly: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "hsl(212 40% 18%)" }}
        aria-hidden
      >
        <BookOpen className="h-8 w-8 text-accent" />
      </div>
      <p className="text-h3 text-text-primary mb-2">
        {overdueOnly ? "No overdue loans" : "No active loans"}
      </p>
      <p className="text-body text-text-secondary">
        {overdueOnly
          ? "All loans are within their due dates."
          : "All books have been returned or no loans have been created yet."}
      </p>
    </div>
  );
}

function MemberEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "hsl(212 40% 18%)" }}
        aria-hidden
      >
        <BookOpen className="h-8 w-8 text-accent" />
      </div>
      <p className="text-h3 text-text-primary mb-2">No active loans</p>
      <p className="text-body text-text-secondary">
        You don&apos;t have any books checked out right now.
      </p>
      <Link href="/books" className="mt-4 text-body text-accent hover:underline underline-offset-2">
        Browse the catalog
      </Link>
    </div>
  );
}

function MemberAccountPending() {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-6">
      <p className="text-body text-text-secondary mb-2">
        Your member account is not yet linked to your login.
      </p>
      <p className="text-meta text-text-tertiary">
        Contact your librarian to link your account. Member self-service is coming soon.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { dateStyle: "medium" });
}
