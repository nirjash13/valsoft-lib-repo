import { CancelHoldButton } from "@/components/circulation/cancel-hold-button";
import { Badge } from "@/components/ui/badge";
import { buildAbility } from "@/lib/auth/ability";
import { requireSession, sessionToTenantCtx } from "@/lib/auth/session";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import type { BookHoldItem } from "@/lib/domain/holds/list-holds-by-book";
import { listHoldsByBook } from "@/lib/domain/holds/list-holds-by-book";
import type { MemberHoldItem } from "@/lib/domain/holds/list-holds-by-member";
import { listHoldsByMember } from "@/lib/domain/holds/list-holds-by-member";
import { getMemberByUserId } from "@/lib/domain/members/get-member-by-user-id";
import { RotateCcw } from "lucide-react";
import Link from "next/link";

interface HoldsPageProps {
  searchParams: Promise<{ bookId?: string }>;
}

/**
 * Holds page — RSC query. Role-aware (REQ-03-04, REQ-03-10).
 *
 * Librarians / tenant_admin: hold queue view. If a bookId is provided as a
 * query param, shows the hold queue for that specific book. Without bookId,
 * this page explains they can see per-book queues on the book detail page.
 *
 * Members: "My Holds" — queued + ready holds with position, cancel button.
 * Requires auth0_user_id linkage (Spec 04) for member-self-service flow.
 */
export default async function HoldsPage({ searchParams }: HoldsPageProps) {
  const params = await searchParams;
  const session = await requireSession();
  const tenantCtx = await sessionToTenantCtx(session);
  const ability = buildAbility(session.roles);

  const canReadAllHolds = ability.can("manage", "Hold") || ability.can("checkin", "Loan");
  // Members now have hold:delete to cancel their own holds (H-1 / M-5 fix).
  // The domain function enforces ownership; canCancelHold is true for members too.
  const canCancelHold = ability.can("delete", "Hold");

  if (canReadAllHolds) {
    // Librarian / admin view.
    if (params.bookId) {
      // Per-book queue view (linked from book detail page).
      const holdQueue = await withTenantTx(tenantCtx, (tx) =>
        listHoldsByBook(tx, tenantCtx, params.bookId as string),
      );

      return (
        <div className="max-w-[800px] mx-auto">
          <div className="mb-6">
            <Link
              href={`/books/${params.bookId}`}
              className="text-meta text-text-secondary hover:text-text-primary mb-2 inline-flex items-center gap-1 transition-instant transition-colors"
            >
              ← Back to Book
            </Link>
            <h1 className="text-h1 text-text-primary">Hold Queue</h1>
            <p className="text-meta text-text-secondary mt-1">
              {holdQueue.length} hold{holdQueue.length !== 1 ? "s" : ""} in queue
            </p>
          </div>

          {holdQueue.length === 0 ? (
            <LibrarianHoldEmptyState />
          ) : (
            <PerBookHoldQueue holds={holdQueue} canCancel={canCancelHold} />
          )}
        </div>
      );
    }

    // No specific book — show a guidance message.
    return (
      <div className="max-w-[800px] mx-auto">
        <h1 className="text-h1 text-text-primary mb-2">Hold Queues</h1>
        <div className="rounded-xl border border-border-subtle bg-surface p-6">
          <p className="text-body text-text-secondary mb-2">Hold queues are managed per book.</p>
          <p className="text-meta text-text-tertiary">
            Navigate to a{" "}
            <Link href="/books" className="text-accent hover:underline underline-offset-2">
              book detail page
            </Link>{" "}
            to see and manage its hold queue.
          </p>
        </div>
      </div>
    );
  }

  // Member view: own holds only.
  // Requires auth0_user_id linkage (Spec 04).
  const member = await withTenantTx(tenantCtx, (tx) =>
    getMemberByUserId(tx, tenantCtx, session.sub),
  );

  if (!member) {
    return (
      <div className="max-w-[800px] mx-auto">
        <h1 className="text-h1 text-text-primary mb-2">My Holds</h1>
        <MemberAccountPending />
      </div>
    );
  }

  const holds = await withTenantTx(tenantCtx, (tx) => listHoldsByMember(tx, tenantCtx, member.id));

  return (
    <div className="max-w-[800px] mx-auto">
      <div className="mb-6">
        <h1 className="text-h1 text-text-primary">My Holds</h1>
        <p className="text-meta text-text-secondary mt-1">
          {holds.length} active hold{holds.length !== 1 ? "s" : ""}
        </p>
      </div>

      {holds.length === 0 ? (
        <MemberHoldEmptyState />
      ) : (
        <MemberHoldList holds={holds} canCancel={canCancelHold} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface MemberHoldListProps {
  holds: ReadonlyArray<MemberHoldItem>;
  canCancel: boolean;
}

/** Renders the member's own holds — shows the book title (joined). */
function MemberHoldList({ holds, canCancel }: MemberHoldListProps) {
  return (
    <ul className="space-y-3 list-none p-0 m-0">
      {holds.map((hold, index) => (
        <li
          key={hold.id}
          className="rounded-xl border border-border-subtle bg-surface p-4 flex items-center justify-between gap-4"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Link
                href={`/books/${hold.bookId}`}
                className="text-body font-medium text-text-primary hover:underline underline-offset-2 truncate"
              >
                {hold.bookTitle}
              </Link>
              {hold.status === "ready" ? (
                <Badge variant="success">Ready for pickup</Badge>
              ) : (
                <Badge variant="secondary">#{index + 1} in queue</Badge>
              )}
            </div>
            {hold.bookAuthors.length > 0 && (
              <p className="text-meta text-text-tertiary mb-1">by {hold.bookAuthors.join(", ")}</p>
            )}
            <p className="text-meta text-text-secondary">
              Queued {formatDate(hold.queuedAt)}
              {hold.readyUntil && ` · Pick up by ${formatDate(hold.readyUntil)}`}
            </p>
          </div>

          {canCancel && (
            <div className="shrink-0">
              <CancelHoldButton holdId={hold.id} bookTitle={hold.bookTitle} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

interface PerBookHoldQueueProps {
  holds: ReadonlyArray<BookHoldItem>;
  canCancel: boolean;
}

/** Renders the per-book queue (librarian/admin view) — shows member name. */
function PerBookHoldQueue({ holds, canCancel }: PerBookHoldQueueProps) {
  return (
    <ul className="space-y-3 list-none p-0 m-0">
      {holds.map((hold, index) => (
        <li
          key={hold.id}
          className="rounded-xl border border-border-subtle bg-surface p-4 flex items-center justify-between gap-4"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-body font-medium text-text-primary truncate">
                {hold.memberDisplayName}
              </span>
              {hold.status === "ready" ? (
                <Badge variant="success">Ready for pickup</Badge>
              ) : (
                <Badge variant="secondary">#{index + 1} in queue</Badge>
              )}
            </div>
            <p className="text-meta text-text-tertiary mb-1">{hold.memberEmail}</p>
            <p className="text-meta text-text-secondary">
              Queued {formatDate(hold.queuedAt)}
              {hold.readyUntil && ` · Pick up by ${formatDate(hold.readyUntil)}`}
            </p>
          </div>

          {canCancel && (
            <div className="shrink-0">
              <CancelHoldButton
                holdId={hold.id}
                bookTitle={`hold for ${hold.memberDisplayName}`}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function LibrarianHoldEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "hsl(212 40% 18%)" }}
        aria-hidden
      >
        <RotateCcw className="h-8 w-8 text-accent" />
      </div>
      <p className="text-h3 text-text-primary mb-2">No holds in queue</p>
      <p className="text-body text-text-secondary">
        No members are currently waiting for this book.
      </p>
    </div>
  );
}

function MemberHoldEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "hsl(212 40% 18%)" }}
        aria-hidden
      >
        <RotateCcw className="h-8 w-8 text-accent" />
      </div>
      <p className="text-h3 text-text-primary mb-2">No active holds</p>
      <p className="text-body text-text-secondary">
        You don&apos;t have any books on hold. Browse the catalog and ask a librarian to place a
        hold when a book is checked out.
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
