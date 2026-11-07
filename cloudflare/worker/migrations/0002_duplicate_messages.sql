CREATE TABLE IF NOT EXISTS duplicate_messages (
  chat_id INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, fingerprint)
);

-- Replace legacy duplicate timestamp indexes with the index used by per-chat cleanup.
DROP INDEX IF EXISTS idx_duplicate_messages_created;
DROP INDEX IF EXISTS idx_duplicate_messages_created_at;
CREATE INDEX IF NOT EXISTS idx_duplicate_messages_chat_time
  ON duplicate_messages(chat_id, created_at);
