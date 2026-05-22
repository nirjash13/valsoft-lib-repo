/**
 * canBorrow — pure helper that derives whether a member may borrow books.
 *
 * Design: this is the canonical source of truth for the `can_borrow` column value.
 * The domain functions (approveMember, rejectMember, updateMemberRole, etc.) call
 * this to compute the column value before every INSERT/UPDATE that changes status
 * or role. The DB column is an application-maintained boolean, not a SQL generated
 * column, so this function and the DB column must always agree.
 *
 * Rule: canBorrow is true iff status === 'active' (regardless of role).
 * Librarians and tenant_admins who are also members may borrow; suspended,
 * rejected, inactive, and pending members may not.
 */

import type { Member } from "@/lib/db/schema/members";

/**
 * Returns true iff the member is allowed to borrow.
 * Accepts the minimal fields so the helper can be called before a row exists
 * (e.g., when computing the initial value for an INSERT).
 */
export function canBorrow(member: Pick<Member, "status">): boolean {
  return member.status === "active";
}
