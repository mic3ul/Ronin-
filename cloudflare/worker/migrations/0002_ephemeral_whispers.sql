CREATE TABLE IF NOT EXISTS whisper_drafts (
 token TEXT PRIMARY KEY,
 chat_id INTEGER NOT NULL,
 sender_user_id INTEGER NOT NULL,
 recipient_user_id INTEGER NOT NULL,
 mode TEXT NOT NULL DEFAULT 'text',
 reply_to_id INTEGER,
 status TEXT NOT NULL DEFAULT 'choosing',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_whisper_drafts_sender ON whisper_drafts(sender_user_id,status,expires_at);
