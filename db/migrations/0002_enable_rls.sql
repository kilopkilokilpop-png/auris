-- Supabase exposes the public schema through its Data API (anon key). AURIS never uses that API:
-- the server connects as the database owner, which bypasses RLS. Enabling RLS without policies
-- makes every table invisible to anon/authenticated roles. Harmless on plain PostgreSQL.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dislikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recognitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recognition_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_file_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE recent_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
