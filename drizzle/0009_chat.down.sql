-- =============================================================================
-- Down migration: 0009_chat
-- Reverses the chat tables and enums added in 0009_chat.sql.
-- Order: drop tables in FK-safe order (dependents first), then enums.
-- =============================================================================

-- chat_messages references chat_threads — drop first
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_refusals;
DROP TABLE IF EXISTS ai_usage;
DROP TABLE IF EXISTS chat_threads;

DROP TYPE IF EXISTS chat_message_role;
DROP TYPE IF EXISTS chat_refusal_reason;
