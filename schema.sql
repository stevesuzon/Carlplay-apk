CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  lifetime INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  autoradio_device TEXT,
  phone_device TEXT,
  recovery_email_hash TEXT,
  recovery_email_mask TEXT,
  recovery_code_box TEXT,
  last_recovery_sent_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS subscriptions_code_hash
ON subscriptions(code_hash);



CREATE TABLE IF NOT EXISTS mail_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS mail_events_category
ON mail_events(category);


CREATE TABLE IF NOT EXISTS admin_presence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS market_verification_votes (
  market_key TEXT NOT NULL,
  field TEXT NOT NULL,
  value_norm TEXT NOT NULL,
  value_display TEXT NOT NULL,
  device_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (market_key, field, device_id)
);

CREATE INDEX IF NOT EXISTS market_votes_value
ON market_verification_votes(market_key, field, value_norm);

CREATE TABLE IF NOT EXISTS market_verification_consensus (
  market_key TEXT NOT NULL,
  field TEXT NOT NULL,
  value_norm TEXT NOT NULL,
  value_display TEXT NOT NULL,
  confirmations INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (market_key, field)
);

CREATE TABLE IF NOT EXISTS market_photo_metadata (
  market_key TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  device_id TEXT NOT NULL,
  user_latitude REAL NOT NULL,
  user_longitude REAL NOT NULL,
  market_latitude REAL NOT NULL,
  market_longitude REAL NOT NULL,
  distance_meters REAL NOT NULL,
  quality_score INTEGER NOT NULL DEFAULT 0,
  stall_count INTEGER NOT NULL DEFAULT 0,
  ai_reason TEXT NOT NULL DEFAULT '',
  replacement_count INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS market_photo_uploads (
  market_key TEXT NOT NULL,
  device_id TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (market_key, device_id)
);

-- Colonnes ajoutées automatiquement par le Worker pour les demandes de modification : requester_email, current_value.
