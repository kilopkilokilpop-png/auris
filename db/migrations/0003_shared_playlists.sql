-- Shared playlists: members (owner / editor) and an invite token. Tracks remember who added them.
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS playlist_members (
  playlist_id BIGINT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','editor')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, user_id)
);
CREATE INDEX IF NOT EXISTS playlist_members_user ON playlist_members (user_id);

ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS added_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

-- Existing playlists: their creator becomes the owner member.
INSERT INTO playlist_members (playlist_id, user_id, role)
SELECT id, user_id, 'owner' FROM playlists
ON CONFLICT DO NOTHING;

-- Same policy as 0002: invisible to the Supabase Data API roles.
ALTER TABLE playlist_members ENABLE ROW LEVEL SECURITY;
