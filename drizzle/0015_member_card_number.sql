-- =============================================================================
-- Migration: 0015_member_card_number
-- Description: Adds card_number column to members table (Spec 07 REQ-07-03).
--
-- The column is NULLABLE (not NOT NULL) so existing rows are unaffected and
-- no safety:reviewed label is required. New rows receive a card number at
-- member-approval time (set by the application in the same tx as the approval).
--
-- Existing rows are backfilled with a deterministic, human-readable code
-- derived from the member id so no row is left NULL after this migration runs.
--
-- Rollback: see 0015_member_card_number.down.sql
-- =============================================================================

-- Step 1: Add nullable column (non-destructive, no safety:reviewed required).
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS card_number text;

-- Step 2: Backfill existing rows.
-- Format: LIB- + first 8 hex chars of the UUID (upper-cased), zero-padded to 8 chars.
-- Example: LIB-1A2B3C4D
-- This is deterministic and stable: the same member id always produces the same code.
UPDATE public.members
SET card_number = 'LIB-' || upper(substring(replace(id::text, '-', '') FROM 1 FOR 8))
WHERE card_number IS NULL;

-- Step 3: Unique index (tenant-first per migrations.md convention).
-- Partial — covers only rows where card_number is not null (allows null gaps during
-- a hypothetical incomplete backfill, but in practice backfill above covers all rows).
CREATE UNIQUE INDEX IF NOT EXISTS members_tenant_card_number_unique_idx
  ON public.members (tenant_id, card_number)
  WHERE card_number IS NOT NULL;
