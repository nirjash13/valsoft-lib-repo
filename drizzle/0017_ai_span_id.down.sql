-- Rollback for migration 0017 — remove span_id from ai_usage
ALTER TABLE ai_usage
  DROP COLUMN IF EXISTS span_id;
