-- Migration 0017 — add span_id to ai_usage (REQ-11-02, REQ-11-07)
--
-- Additive change: nullable varchar(64) column for Langfuse span cross-referencing.
-- No NOT NULL backfill required; legacy rows remain valid with NULL span_id.
-- No RLS change needed — ai_usage already has FORCE RLS from migration 0009.

ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS span_id varchar(64);
