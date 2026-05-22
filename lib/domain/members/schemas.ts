/**
 * Zod schemas for member management Server Actions (Spec 04).
 *
 * Each schema is the single source of truth for its action's input:
 *   1. Server Action input validation (next-safe-action .schema())
 *   2. Client form parsing (react-hook-form + zodResolver) — Run B
 *   3. Type derivation via z.infer<typeof …Schema>
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// SelfSignupSchema — public signup form (unauthenticated)
// ---------------------------------------------------------------------------

/**
 * REQ-04-02: name + email + agreed-to-terms.
 * The tenantId is NOT in the schema — it is resolved from the hostname
 * in the Route Handler (app/api/members/signup/route.ts), never from user input.
 */
export const SelfSignupSchema = z.object({
  displayName: z.string().min(1, "Name is required").max(200),
  email: z.string().min(1, "Email is required").email("Must be a valid email address").max(320),
  phone: z.string().max(30).optional(),
  agreedToTerms: z.literal(true, {
    errorMap: () => ({ message: "You must agree to the terms to continue" }),
  }),
});

export type SelfSignupInput = z.infer<typeof SelfSignupSchema>;

// ---------------------------------------------------------------------------
// ApproveMemberSchema
// ---------------------------------------------------------------------------

export const ApproveMemberSchema = z.object({
  memberId: z.string().uuid(),
  /** ISO 8601 string — optimistic concurrency guard (matches members.updated_at). */
  expectedUpdatedAt: z.string().datetime(),
});

export type ApproveMemberInput = z.infer<typeof ApproveMemberSchema>;

// ---------------------------------------------------------------------------
// RejectMemberSchema
// ---------------------------------------------------------------------------

export const RejectMemberSchema = z.object({
  memberId: z.string().uuid(),
  rejectionReason: z.string().min(1, "Rejection reason is required").max(1000),
  expectedUpdatedAt: z.string().datetime(),
});

export type RejectMemberInput = z.infer<typeof RejectMemberSchema>;

// ---------------------------------------------------------------------------
// UpdateMemberSchema — member self-updates own profile
// ---------------------------------------------------------------------------

export const UpdateMemberSchema = z.object({
  memberId: z.string().uuid(),
  displayName: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).optional(),
  expectedUpdatedAt: z.string().datetime(),
});

export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;

// ---------------------------------------------------------------------------
// UpdateMemberRoleSchema — tenant_admin promotes / demotes a member's role
// ---------------------------------------------------------------------------

export const UpdateMemberRoleSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(["tenant_admin", "librarian", "member"]),
  expectedUpdatedAt: z.string().datetime(),
});

export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleSchema>;

// ---------------------------------------------------------------------------
// UpdateMemberAdminSchema — tenant_admin edits another member's profile/status
// ---------------------------------------------------------------------------

/**
 * Admin-only update: can change status, canBorrow, displayName, phone for any member.
 * Distinct from UpdateMemberSchema which enforces ownership (self-edit only).
 *
 * @permission member:manage (tenant_admin only via updateMemberAdminAction)
 */
export const UpdateMemberAdminSchema = z.object({
  memberId: z.string().uuid(),
  status: z.enum(["active", "inactive", "suspended"]).optional(),
  displayName: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).optional(),
  expectedUpdatedAt: z.string().datetime(),
});

export type UpdateMemberAdminInput = z.infer<typeof UpdateMemberAdminSchema>;

// ---------------------------------------------------------------------------
// ListPendingMembersSchema — query for approval queue (paginated)
// ---------------------------------------------------------------------------

export const ListPendingMembersSchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export type ListPendingMembersInput = z.infer<typeof ListPendingMembersSchema>;
