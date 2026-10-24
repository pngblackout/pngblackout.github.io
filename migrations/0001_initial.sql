CREATE TABLE IF NOT EXISTS outages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  description TEXT,
  started_at TEXT NOT NULL,
  restored_at TEXT,
  created_at TEXT NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'community',
  CHECK (latitude BETWEEN -9.75 AND -9.25),
  CHECK (longitude BETWEEN 146.90 AND 147.40)
);

CREATE INDEX IF NOT EXISTS idx_outages_started_at ON outages(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_outages_restored_at ON outages(restored_at);
