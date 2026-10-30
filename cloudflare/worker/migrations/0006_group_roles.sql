CREATE TABLE IF NOT EXISTS group_roles (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('rafiq','thaer','mujahid','munadil','ansar')),
  granted_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_roles_chat_role ON group_roles(chat_id,role);
