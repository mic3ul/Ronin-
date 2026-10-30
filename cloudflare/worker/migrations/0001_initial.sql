CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS members (
  user_id INTEGER PRIMARY KEY,
  message_count INTEGER NOT NULL DEFAULT 0,
  reputation_points INTEGER NOT NULL DEFAULT 0,
  profanity_violations INTEGER NOT NULL DEFAULT 0,
  spam_violations INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_chat_id INTEGER NOT NULL,
  report_message_id INTEGER NOT NULL,
  source_chat_id INTEGER NOT NULL,
  source_message_id INTEGER NOT NULL,
  reported_user_id INTEGER NOT NULL,
  reporter_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_chat_id, source_message_id, reporter_user_id)
);
CREATE TABLE IF NOT EXISTS newcomer_events (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_newcomer_events_chat_time ON newcomer_events(chat_id, created_at);
CREATE TABLE IF NOT EXISTS burst_alerts (
  chat_id INTEGER PRIMARY KEY,
  alerted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
