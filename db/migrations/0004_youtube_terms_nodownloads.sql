-- AURIS v2: YouTube (official embedded player) + Jamendo, no downloads.

-- Terms of use / privacy policy must be accepted before any feature (YouTube API Developer Policies III.A.2).
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Snapshots of YouTube API data are "non-authorized data": refreshed or deleted within 30 days.
CREATE INDEX IF NOT EXISTS track_snapshots_updated ON track_snapshots (updated_at);

-- Service-wide counters (daily spending cap for paid recognition).
CREATE TABLE IF NOT EXISTS service_usage (
  kind  TEXT NOT NULL,
  day   DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, day)
);
ALTER TABLE service_usage ENABLE ROW LEVEL SECURITY;

-- Downloads are removed from the product: drop what they stored.
DROP TABLE IF EXISTS downloads;
DROP TABLE IF EXISTS telegram_file_cache;
