CREATE TABLE IF NOT EXISTS private_users (
  user_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  chat_id INTEGER NOT NULL,
  registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_private_users_username
  ON private_users(username COLLATE NOCASE) WHERE username IS NOT NULL;
CREATE TABLE IF NOT EXISTS whispers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_user_id INTEGER NOT NULL,
  recipient_user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opened_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_whispers_recipient_status
  ON whispers(recipient_user_id, status, created_at);
CREATE TABLE IF NOT EXISTS game_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  creator_user_id INTEGER NOT NULL,
  game_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_game_sessions_chat_status
  ON game_sessions(chat_id, status, created_at);
