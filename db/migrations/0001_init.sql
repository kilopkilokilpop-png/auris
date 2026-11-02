-- AURIS initial schema. Users are identified by Telegram user id.
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT PRIMARY KEY,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT,
  username      TEXT,
  photo_url     TEXT,
  language_code TEXT,
  -- Badge "AURIS MASTER" is shown only by this flag. No payments.
  is_master     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Set once the user pressed /start in the bot (we can message them).
  bot_started   BOOLEAN NOT NULL DEFAULT FALSE,
  onboarded     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id            BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  quality            TEXT NOT NULL DEFAULT 'standard' CHECK (quality IN ('standard','hifi','hires')),
  wave_mood          TEXT NOT NULL DEFAULT 'any',
  wave_mode          TEXT NOT NULL DEFAULT 'mix' CHECK (wave_mode IN ('favorite','mix','discovery')),
  onboarding_genres  JSONB NOT NULL DEFAULT '[]'::jsonb,
  onboarding_artists JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Snapshot cache of track metadata we have seen (so history survives provider hiccups).
CREATE TABLE IF NOT EXISTS track_snapshots (
  track_id   TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Behaviour signals for recommendations.
CREATE TABLE IF NOT EXISTS events (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id     TEXT NOT NULL,
  artist_id    TEXT,
  genres       JSONB NOT NULL DEFAULT '[]'::jsonb,
  kind         TEXT NOT NULL CHECK (kind IN ('play_start','play_complete','skip','repeat','like','unlike','dislike','playlist_add','recognized')),
  position_sec REAL,
  duration_sec REAL,
  listened_sec REAL NOT NULL DEFAULT 0,
  context      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_user_time ON events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS likes (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS dislikes (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id   TEXT NOT NULL,
  artist_id  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS album_likes (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id   TEXT NOT NULL,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, album_id)
);

CREATE TABLE IF NOT EXISTS playlists (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id BIGINT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    TEXT NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS recognitions (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  artist           TEXT NOT NULL,
  album            TEXT,
  cover_url        TEXT,
  matched_track_id TEXT,
  unavailable_reason TEXT,
  source           TEXT NOT NULL CHECK (source IN ('miniapp','bot')),
  provider         TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recognitions_user_time ON recognitions (user_id, created_at DESC);

-- Result cache keyed by sha256 of the uploaded audio (no audio is stored).
CREATE TABLE IF NOT EXISTS recognition_cache (
  audio_sha256 TEXT PRIMARY KEY,
  result       JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only the fact of a download: who, what, when, from where. Never the file.
CREATE TABLE IF NOT EXISTS downloads (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id   TEXT NOT NULL,
  provider   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS downloads_user_time ON downloads (user_id, created_at DESC);

-- Telegram file_id reuse; only written when the provider terms allow it.
CREATE TABLE IF NOT EXISTS telegram_file_cache (
  track_id   TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  file_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recent_searches (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, query)
);

-- Rolling counters for quotas (recognition, downloads).
CREATE TABLE IF NOT EXISTS usage_counters (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  day     DATE NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, day)
);
