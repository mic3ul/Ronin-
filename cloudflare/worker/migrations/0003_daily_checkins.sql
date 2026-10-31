CREATE TABLE IF NOT EXISTS daily_checkins (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  checkin_date TEXT NOT NULL,
  reward INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(chat_id, user_id, checkin_date)
);
