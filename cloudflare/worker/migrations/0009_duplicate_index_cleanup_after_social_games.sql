-- The games branch adds migrations 0003_duplicate_messages.sql and
-- 0007_duplicate_messages.sql, which recreate legacy timestamp-only indexes.
-- If the base branch's 0008 cleanup was already recorded before these files
-- were introduced, D1 will not rerun 0008. Repeat the cleanup at the end of
-- the stacked feature migration sequence.
DROP INDEX IF EXISTS idx_duplicate_messages_created;
DROP INDEX IF EXISTS idx_duplicate_messages_created_at;

CREATE INDEX IF NOT EXISTS idx_duplicate_messages_chat_time
  ON duplicate_messages(chat_id, created_at);
