CREATE TABLE IF NOT EXISTS duplicate_messages (chat_id INTEGER NOT NULL, fingerprint TEXT NOT NULL, message_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(chat_id, fingerprint));
CREATE INDEX IF NOT EXISTS idx_duplicate_messages_created ON duplicate_messages(created_at);
