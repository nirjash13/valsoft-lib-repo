-- =============================================================================
-- Rollback: 0007_member_management
-- Description: Reverses the Spec 04 member management schema extensions.
-- WARNING: Dropping columns is destructive and may lose data. This rollback
--          should only be applied on a Neon preview branch before the migration
--          has been applied to staging or production.
-- =============================================================================

-- Drop indexes first (must precede column drops that back them)
DROP INDEX IF EXISTS members_auth0_user_id_idx;
DROP INDEX IF EXISTS members_tenant_role_idx;
DROP INDEX IF EXISTS members_tenant_approval_status_idx;

-- Drop columns added by this migration
ALTER TABLE members
  DROP COLUMN IF EXISTS rejection_reason,
  DROP COLUMN IF EXISTS rejected_by,
  DROP COLUMN IF EXISTS rejected_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS can_borrow,
  DROP COLUMN IF EXISTS role;

-- Drop member_role enum
DROP TYPE IF EXISTS member_role;

-- Note: 'rejected' and 'inactive' values were added to member_status enum.
-- Postgres does NOT support removing enum values. To fully roll back the enum,
-- the workaround is:
--   1. Create a new enum without those values.
--   2. ALTER TABLE members ALTER COLUMN status TYPE <new_enum> USING status::text::<new_enum>.
--   3. Drop the old enum.
-- This is a complex, table-rewriting operation and is NOT automated here.
-- For a Neon preview branch rollback, dropping the branch is safer.
-- Document: enum value removal requires safety:reviewed + manual DBA intervention.
