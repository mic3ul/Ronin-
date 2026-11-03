-- Final cleanup after the legacy duplicate-message migrations in the games branch.
-- Those migrations may recreate both timestamp-only indexes after 0002 runs.
DROP INDEX IF EXISTS idx_duplicate_messages_created;
DROP INDEX IF EXISTS idx_duplicate_messages_created_at;

CREATE INDEX IF NOT EXISTS idx_duplicate_messages_chat_time
  ON duplicate_messages(chat_id, created_at);
