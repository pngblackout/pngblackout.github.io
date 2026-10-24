CREATE TABLE IF NOT EXISTS outages_location_migration (
  id INTEGER PRIMARY KEY CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS outages_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  latitude REAL,
  longitude REAL,
  city TEXT,
  suburb TEXT,
  locality TEXT,
  description TEXT,
  started_at TEXT NOT NULL,
  restored_at TEXT,
  created_at TEXT NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'community',
  CHECK (latitude BETWEEN -11.7 AND -0.5),
  CHECK (longitude BETWEEN 140.8 AND 156.3)
);

INSERT OR IGNORE INTO outages_v2 (id, latitude, longitude, description, started_at, restored_at, created_at, report_count, source)
SELECT id, latitude, longitude, description, started_at, restored_at, created_at, report_count, source FROM outages;

DROP TABLE outages;
ALTER TABLE outages_v2 RENAME TO outages;
DROP TABLE outages_location_migration;

CREATE INDEX IF NOT EXISTS idx_outages_started_at ON outages(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_outages_restored_at ON outages(restored_at);
