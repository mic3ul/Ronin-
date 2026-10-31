CREATE TABLE IF NOT EXISTS group_members (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  first_name TEXT,
  username TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  reputation_points INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_rank
  ON group_members(chat_id, reputation_points DESC, message_count DESC);
