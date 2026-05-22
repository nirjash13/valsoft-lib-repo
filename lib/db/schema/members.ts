import { boolean, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, tenantIdColumn, updatedAt } from "./_shared";
import { tenants } from "./tenants";

/**
 * members_status — patron account state.
 *
 * - pending:    signed up but not yet approved (Spec 04 self-signup flow).
 * - active:     approved; can borrow and place holds.
 * - suspended:  blocked from circulation actions by an admin.
 * - rejected:   signup was rejected by a librarian. Row retained 90 days then anonymized (NFR-04-04).
 * - inactive:   deactivated by tenant_admin (REQ-04-07). Auth0 session is revoked.
 */
export const memberStatusEnum = pgEnum("member_status", [
  "pending",
  "active",
  "suspended",
  "rejected",
  "inactive",
]);

/**
 * member_role — the role a member row holds within its tenant.
 *
 * Mirrors the CASL Role type in lib/auth/permission.ts. Stored on the member row
 * so the Approval flow can promote a pending signup to the correct role. The CASL
 * Ability is still resolved from the JWT at request time (Auth0 Post-Login Action
 * writes roles[] from event.authorization.roles); this column is the canonical
 * record of *intended* role and is used by invite-staff and update-member-role.
 */
export const memberRoleEnum = pgEnum("member_role", [
  "system_owner",
  "tenant_admin",
  "librarian",
  "member",
  "guest",
]);

/**
 * member_email_status — deliverability state for the member's email address.
 *
 * ok:        email is deliverable; sends are permitted.
 * bouncing:  a permanent bounce was received from Resend; sends are suppressed (REQ-07-08).
 * complained: a spam complaint was received; lifecycle sends suppressed, transactional may continue.
 */
export const memberEmailStatusEnum = pgEnum("member_email_status", [
  "ok",
  "bouncing",
  "complained",
]);

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn().references(() => tenants.id, { onDelete: "cascade" }),

    // auth0_user_id: nullable until the account is linked (or until the librarian
    // approves and sends an Auth0 Organization invitation). After approval the
    // Auth0 invitation callback writes the sub back here. Text (not varchar) to
    // match 0000_init.sql column type and avoid destructive ALTER.
    auth0UserId: text("auth0_user_id"),

    status: memberStatusEnum("status").notNull().default("active"),

    // The member's intended role within this tenant.
    // Default is "member" for self-signups. Librarians/admins get their role set
    // explicitly during invite-staff flow or updated via updateMemberRoleAction.
    role: memberRoleEnum("role").notNull().default("member"),

    // display_name / email are text (matches 0000_init.sql:79-80); varchar would
    // cause drizzle-kit to emit destructive ALTER COLUMN TYPE.
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),

    // Optional contact fields — fixed v1 schema (Q-04-04: configurable in v2).
    phone: text("phone"),

    // Approval workflow (Spec 04 REQ-04-04 / REQ-04-05)
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"), // FK to members.id of the approving librarian/admin

    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by"), // FK to members.id of the rejecting librarian/admin
    rejectionReason: text("rejection_reason"),

    /**
     * canBorrow — computed boolean: true iff status='active' AND role='member' or above
     * and the account is not suspended/inactive/rejected.
     *
     * Design choice: stored as a real column (not a generated/computed column)
     * because Drizzle ORM does not yet support SQL generated columns portably,
     * and keeping it as an application-maintained boolean lets the domain layer
     * flip it atomically when suspending/reinstating a member without requiring
     * a SQL expression rewrite. The `canBorrow` helper in lib/domain/members/can-borrow.ts
     * is the canonical derivation — the column is always set to match it on every write.
     * NFR: canBorrow must be `true` iff status='active'. Enforced in domain layer.
     */
    canBorrow: boolean("can_borrow").notNull().default(false),

    // Email deliverability state (Spec 07 REQ-07-08).
    // Set to 'bouncing' by the Resend webhook handler on permanent bounce.
    // Used by send-transactional and send-lifecycle to suppress further sends.
    emailStatus: memberEmailStatusEnum("email_status").notNull().default("ok"),

    // Opt-out flag for lifecycle emails (REQ-07-09 / US-08).
    // Transactional emails (welcome, hold-ready) are always sent regardless of this flag.
    // Toggled via the unsubscribe link in lifecycle emails.
    lifecycleEmailsEnabled: boolean("lifecycle_emails_enabled").notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),

    // Soft-delete — present in DB since 0000_init.sql:82
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Case-sensitive unique (present in DB since 0000_init.sql:84)
    // A case-insensitive unique index on (tenant_id, lower(email)) was added in
    // 0006_circulation.sql:37. Drizzle cannot express functional unique indexes;
    // that index is hand-written in the migration SQL only.
    unique("members_tenant_email_unique").on(table.tenantId, table.email),
  ],
);

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
