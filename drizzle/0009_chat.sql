-- =============================================================================
-- Migration: 0009_chat
-- Description: Reader's Advisor chat tables — chat_threads, chat_messages,
--              chat_refusals, ai_usage — plus the two enums they require.
-- Spec:        06 — Reader's Advisor (Conversational RAG Chat)
--
-- All four tables are tenant-scoped:
--   • tenant_id NOT NULL
--   • composite tenant-first index
--   • RLS ENABLE + FORCE ROW LEVEL SECURITY
--   • policy using assert_tenant()
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE chat_message_role AS ENUM ('user', 'assistant');

CREATE TYPE chat_refusal_reason AS ENUM ('off_catalog', 'policy', 'error');

-- ---------------------------------------------------------------------------
-- chat_threads
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_threads (
  id               uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid            NOT NULL,
  member_id        uuid            NOT NULL,
  page_context     text            NOT NULL,
  title            text,
  last_message_at  timestamptz(3)  NOT NULL DEFAULT now(),
  archived_at      timestamptz(3),
  created_at       timestamptz(3)  NOT NULL DEFAULT now(),
  updated_at       timestamptz(3)  NOT NULL DEFAULT now()
);

-- Composite tenant-first index (required by migrations.md)
CREATE INDEX IF NOT EXISTS chat_threads_tenant_idx
  ON chat_threads (tenant_id, member_id, page_context);

-- Partial unique index: at most one active (non-archived) thread per
-- (tenant, member, page_context). Allows re-opening after archival.
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_active_unique
  ON chat_threads (tenant_id, member_id, page_context)
  WHERE archived_at IS NULL;

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_threads FORCE ROW LEVEL SECURITY;

CREATE POLICY chat_threads_tenant_isolation ON chat_threads
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

GRANT SELECT, INSERT, UPDATE ON chat_threads TO stack_app;

-- ---------------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_messages (
  id          uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid                  NOT NULL,
  thread_id   uuid                  NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role        chat_message_role     NOT NULL,
  content     text                  NOT NULL,
  book_ids    uuid[],
  created_at  timestamptz(3)        NOT NULL DEFAULT now()
);

-- Composite tenant-first index — covers per-thread chronological listing
CREATE INDEX IF NOT EXISTS chat_messages_tenant_thread_at_idx
  ON chat_messages (tenant_id, thread_id, created_at);

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY chat_messages_tenant_isolation ON chat_messages
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

GRANT SELECT, INSERT ON chat_messages TO stack_app;

-- ---------------------------------------------------------------------------
-- chat_refusals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_refusals (
  id              uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid                  NOT NULL,
  thread_id       uuid,
  member_id       uuid,
  user_message    text                  NOT NULL,
  refusal_reason  chat_refusal_reason   NOT NULL,
  created_at      timestamptz(3)        NOT NULL DEFAULT now()
);

-- Composite tenant-first index — covers per-tenant refusal audit queries
CREATE INDEX IF NOT EXISTS chat_refusals_tenant_at_idx
  ON chat_refusals (tenant_id, created_at);

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE chat_refusals ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_refusals FORCE ROW LEVEL SECURITY;

CREATE POLICY chat_refusals_tenant_isolation ON chat_refusals
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

GRANT SELECT, INSERT ON chat_refusals TO stack_app;

-- ---------------------------------------------------------------------------
-- ai_usage
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_usage (
  id                 uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid            NOT NULL,
  feature            text            NOT NULL,
  model              text            NOT NULL,
  prompt_tokens      integer         NOT NULL DEFAULT 0,
  completion_tokens  integer         NOT NULL DEFAULT 0,
  cost_usd           numeric(10,4)   NOT NULL DEFAULT 0,
  thread_id          uuid,
  created_at         timestamptz(3)  NOT NULL DEFAULT now()
);

-- Composite tenant-first index — covers monthly cost aggregation queries
CREATE INDEX IF NOT EXISTS ai_usage_tenant_at_idx
  ON ai_usage (tenant_id, created_at);

-- RLS (required by migrations.md + Spec 01 pattern)
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_usage_tenant_isolation ON ai_usage
  USING  (tenant_id = assert_tenant())
  WITH CHECK (tenant_id = assert_tenant());

GRANT SELECT, INSERT ON ai_usage TO stack_app;
