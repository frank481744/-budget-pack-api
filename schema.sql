CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'America/Toronto',
  data_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_families_join_code
ON families(join_code);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (family_id) REFERENCES families(id)
);

CREATE INDEX IF NOT EXISTS idx_members_family
ON members(family_id);

CREATE INDEX IF NOT EXISTS idx_members_token
ON members(token_hash);

CREATE TABLE IF NOT EXISTS reminder_log (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  reminder_key TEXT NOT NULL UNIQUE,
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminder_family
ON reminder_log(family_id);
