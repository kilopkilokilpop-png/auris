import type { EventKind, Mood, QualityTier, Recognition, Track, UserProfile, WaveMode } from '@auris/shared';
import type { TelegramUser } from '../auth/initData.js';
import type { Db } from '../db/db.js';
import type { Signal } from '../reco/scoring.js';

interface UserRow {
  id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
  is_master: boolean;
  bot_started: boolean;
  onboarded: boolean;
  quality: QualityTier;
  wave_mood: Mood;
  wave_mode: WaveMode;
  onboarding_genres: string[];
  onboarding_artists: string[];
  language_code: string | null;
}

/** All SQL lives here. Every query is parameterised. */
export class Store {
  /**
   * `providers` = ids of the configured music sources. Track lists and counts only include their
   * tracks; rows of disconnected sources stay in the DB and come back if the source returns.
   */
  constructor(
    readonly db: Db,
    private readonly providers: string[] = [],
  ) {}

  /** `AND split_part(col, ':', 1) = ANY($n)` when sources are known, else no filter. */
  private activeSql(col: string, n: number): string {
    return this.providers.length ? ` AND split_part(${col}, ':', 1) = ANY($${n}::text[])` : '';
  }
  private activeArgs(): unknown[] {
    return this.providers.length ? [this.providers] : [];
  }

  async upsertUser(u: TelegramUser): Promise<void> {
    await this.db.query(
      `INSERT INTO users (id, first_name, last_name, username, photo_url, language_code)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
         username=EXCLUDED.username, photo_url=COALESCE(EXCLUDED.photo_url, users.photo_url),
         language_code=EXCLUDED.language_code, updated_at=now()`,
      [u.id, u.first_name, u.last_name ?? null, u.username ?? null, u.photo_url ?? null, u.language_code ?? null],
    );
    await this.db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [u.id]);
  }

  /** Bot side: ensures a row exists without overwriting richer Mini App data. */
  async touchUserFromBot(u: { id: number; first_name?: string; last_name?: string; username?: string }, botStarted: boolean): Promise<void> {
    await this.db.query(
      `INSERT INTO users (id, first_name, last_name, username, bot_started) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET bot_started = users.bot_started OR EXCLUDED.bot_started, updated_at=now()`,
      [u.id, u.first_name ?? '', u.last_name ?? null, u.username ?? null, botStarted],
    );
    await this.db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [u.id]);
  }

  async setBotStarted(userId: number, v: boolean) {
    await this.db.query('UPDATE users SET bot_started=$2, updated_at=now() WHERE id=$1', [userId, v]);
  }

  async getUserRow(id: number): Promise<UserRow | undefined> {
    const r = await this.db.query<UserRow>(
      `SELECT u.id, u.first_name, u.last_name, u.username, u.photo_url, u.is_master, u.bot_started, u.onboarded,
              s.quality, s.wave_mood, s.wave_mode, s.onboarding_genres, s.onboarding_artists, u.language_code
       FROM users u JOIN user_settings s ON s.user_id = u.id WHERE u.id=$1`,
      [id],
    );
    return r.rows[0];
  }

  async getProfile(id: number): Promise<UserProfile | undefined> {
    const u = await this.getUserRow(id);
    if (!u) return undefined;
    const [liked, playlists, listened] = await Promise.all([
      this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM likes WHERE user_id=$1${this.activeSql('track_id', 2)}`, [id, ...this.activeArgs()]),
      this.db.query<{ n: number }>('SELECT count(*)::int AS n FROM playlist_members WHERE user_id=$1', [id]),
      this.db.query<{ s: number | null }>('SELECT COALESCE(sum(listened_sec),0)::float8 AS s FROM events WHERE user_id=$1', [id]),
    ]);
    return {
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name ?? undefined,
      username: u.username ?? undefined,
      photoUrl: u.photo_url ?? undefined,
      isMaster: u.is_master,
      botStarted: u.bot_started,
      onboarded: u.onboarded,
      settings: { quality: u.quality, waveMood: u.wave_mood, waveMode: u.wave_mode },
      stats: {
        liked: liked.rows[0]?.n ?? 0,
        playlists: playlists.rows[0]?.n ?? 0,
        listenedHours: Math.round(((listened.rows[0]?.s ?? 0) / 3600) * 10) / 10,
      },
    };
  }

  async updateSettings(id: number, s: { quality?: QualityTier; waveMood?: Mood; waveMode?: WaveMode }) {
    await this.db.query(
      `UPDATE user_settings SET quality=COALESCE($2,quality), wave_mood=COALESCE($3,wave_mood), wave_mode=COALESCE($4,wave_mode) WHERE user_id=$1`,
      [id, s.quality ?? null, s.waveMood ?? null, s.waveMode ?? null],
    );
  }

  async setOnboarding(id: number, genres: string[], artists: string[]) {
    await this.db.query('UPDATE user_settings SET onboarding_genres=$2::jsonb, onboarding_artists=$3::jsonb WHERE user_id=$1', [id, JSON.stringify(genres), JSON.stringify(artists)]);
    await this.db.query('UPDATE users SET onboarded=TRUE WHERE id=$1', [id]);
  }

  // ---------- track snapshots ----------
  async saveSnapshots(tracks: Track[]) {
    for (const t of tracks) {
      await this.db.query(
        `INSERT INTO track_snapshots (track_id, data) VALUES ($1,$2::jsonb)
         ON CONFLICT (track_id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
        [t.id, JSON.stringify(t)],
      );
    }
  }
  async snapshots(ids: string[]): Promise<Map<string, Track>> {
    if (!ids.length) return new Map();
    const r = await this.db.query<{ track_id: string; data: Track }>('SELECT track_id, data FROM track_snapshots WHERE track_id = ANY($1::text[])', [ids]);
    return new Map(r.rows.map((x) => [x.track_id, x.data]));
  }

  // ---------- events ----------
  async addEvent(userId: number, e: { trackId: string; kind: EventKind; artistId?: string; genres?: string[]; positionSec?: number; durationSec?: number; listenedSec?: number; context?: string }) {
    await this.db.query(
      `INSERT INTO events (user_id, track_id, artist_id, genres, kind, position_sec, duration_sec, listened_sec, context)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)`,
      [userId, e.trackId, e.artistId ?? null, JSON.stringify(e.genres ?? []), e.kind, e.positionSec ?? null, e.durationSec ?? null, e.listenedSec ?? 0, e.context ?? null],
    );
  }
  async signals(userId: number, limit = 2000): Promise<Signal[]> {
    const r = await this.db.query<{ kind: Signal['kind']; track_id: string; artist_id: string | null; genres: string[]; position_sec: number | null; duration_sec: number | null; created_at: Date | string; tags: string[] | null }>(
      `SELECT e.kind, e.track_id, e.artist_id, e.genres, e.position_sec, e.duration_sec, e.created_at, (s.data->'tags') AS tags
       FROM events e LEFT JOIN track_snapshots s ON s.track_id = e.track_id
       WHERE e.user_id=$1 ORDER BY e.created_at DESC LIMIT $2`,
      [userId, limit],
    );
    return r.rows.map((x) => ({
      kind: x.kind,
      trackId: x.track_id,
      artistId: x.artist_id,
      genres: x.genres ?? [],
      tags: x.tags ?? [],
      positionSec: x.position_sec,
      durationSec: x.duration_sec,
      at: new Date(x.created_at),
    }));
  }
  async recentTrackIds(userId: number, n: number): Promise<string[]> {
    const r = await this.db.query<{ track_id: string }>(
      `SELECT track_id FROM (SELECT track_id, max(created_at) AS t FROM events WHERE user_id=$1 AND kind IN ('play_start','play_complete','skip')${this.activeSql('track_id', 3)} GROUP BY track_id) x ORDER BY t DESC LIMIT $2`,
      [userId, n, ...this.activeArgs()],
    );
    return r.rows.map((x) => x.track_id);
  }
  async recentlyPlayed(userId: number, n: number): Promise<string[]> {
    return this.recentTrackIds(userId, n);
  }

  // ---------- likes ----------
  async like(userId: number, trackId: string) {
    await this.db.query('INSERT INTO likes (user_id, track_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, trackId]);
    await this.db.query('DELETE FROM dislikes WHERE user_id=$1 AND track_id=$2', [userId, trackId]);
  }
  async unlike(userId: number, trackId: string) {
    await this.db.query('DELETE FROM likes WHERE user_id=$1 AND track_id=$2', [userId, trackId]);
  }
  async dislike(userId: number, trackId: string, artistId?: string) {
    await this.db.query('INSERT INTO dislikes (user_id, track_id, artist_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [userId, trackId, artistId ?? null]);
    await this.db.query('DELETE FROM likes WHERE user_id=$1 AND track_id=$2', [userId, trackId]);
  }
  async likedIds(userId: number, limit = 500): Promise<string[]> {
    const r = await this.db.query<{ track_id: string }>(`SELECT track_id FROM likes WHERE user_id=$1${this.activeSql('track_id', 3)} ORDER BY created_at DESC LIMIT $2`, [
      userId,
      limit,
      ...this.activeArgs(),
    ]);
    return r.rows.map((x) => x.track_id);
  }
  async isLiked(userId: number, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const r = await this.db.query<{ track_id: string }>('SELECT track_id FROM likes WHERE user_id=$1 AND track_id = ANY($2::text[])', [userId, ids]);
    return new Set(r.rows.map((x) => x.track_id));
  }
  async likeAlbum(userId: number, albumId: string, data: unknown) {
    await this.db.query('INSERT INTO album_likes (user_id, album_id, data) VALUES ($1,$2,$3::jsonb) ON CONFLICT (user_id, album_id) DO UPDATE SET data=EXCLUDED.data', [userId, albumId, JSON.stringify(data)]);
  }
  async unlikeAlbum(userId: number, albumId: string) {
    await this.db.query('DELETE FROM album_likes WHERE user_id=$1 AND album_id=$2', [userId, albumId]);
  }
  async likedAlbums(userId: number) {
    const r = await this.db.query<{ data: unknown }>('SELECT data FROM album_likes WHERE user_id=$1 ORDER BY created_at DESC', [userId]);
    return r.rows.map((x) => x.data);
  }

  // ---------- playlists (shared: owner + editors) ----------
  async playlists(userId: number) {
    const r = await this.db.query<{ id: number; title: string; created_at: Date | string; role: 'owner' | 'editor'; n: number; members: number; first: string | null }>(
      `SELECT p.id, p.title, p.created_at, m.role,
              (SELECT count(*)::int FROM playlist_tracks pt WHERE pt.playlist_id = p.id${this.activeSql('pt.track_id', 2)}) AS n,
              (SELECT count(*)::int FROM playlist_members pm WHERE pm.playlist_id = p.id) AS members,
              (SELECT track_id FROM playlist_tracks pf WHERE pf.playlist_id = p.id${this.activeSql('pf.track_id', 2)} ORDER BY added_at LIMIT 1) AS first
       FROM playlists p JOIN playlist_members m ON m.playlist_id = p.id AND m.user_id = $1
       ORDER BY p.created_at DESC`,
      [userId, ...this.activeArgs()],
    );
    return r.rows;
  }
  async createPlaylist(userId: number, title: string) {
    const r = await this.db.query<{ id: number }>('INSERT INTO playlists (user_id, title) VALUES ($1,$2) RETURNING id', [userId, title]);
    const id = r.rows[0]!.id;
    await this.db.query(`INSERT INTO playlist_members (playlist_id, user_id, role) VALUES ($1,$2,'owner')`, [id, userId]);
    return id;
  }
  /** Caller's access to a playlist, or undefined (not a member -> behaves as "not found"). */
  async playlistAccess(userId: number, id: number) {
    const r = await this.db.query<{ id: number; title: string; role: 'owner' | 'editor'; owner_id: number }>(
      `SELECT p.id, p.title, m.role, p.user_id AS owner_id FROM playlists p
       JOIN playlist_members m ON m.playlist_id = p.id AND m.user_id = $2 WHERE p.id = $1`,
      [id, userId],
    );
    return r.rows[0];
  }
  async addToPlaylist(playlistId: number, trackId: string, userId?: number) {
    await this.db.query('INSERT INTO playlist_tracks (playlist_id, track_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [playlistId, trackId, userId ?? null]);
  }
  async removeFromPlaylist(playlistId: number, trackId: string) {
    await this.db.query('DELETE FROM playlist_tracks WHERE playlist_id=$1 AND track_id=$2', [playlistId, trackId]);
  }
  async playlistTracks(playlistId: number) {
    const r = await this.db.query<{ track_id: string; added_by: number | null }>('SELECT track_id, added_by FROM playlist_tracks WHERE playlist_id=$1 ORDER BY added_at', [playlistId]);
    return r.rows;
  }
  async playlistTrackIds(playlistId: number) {
    return (await this.playlistTracks(playlistId)).map((x) => x.track_id);
  }
  async playlistMembers(playlistId: number) {
    const r = await this.db.query<{ user_id: number; first_name: string; last_name: string | null; role: 'owner' | 'editor' }>(
      `SELECT m.user_id, u.first_name, u.last_name, m.role FROM playlist_members m JOIN users u ON u.id = m.user_id
       WHERE m.playlist_id=$1 ORDER BY (m.role = 'owner') DESC, m.joined_at`,
      [playlistId],
    );
    return r.rows.map((x) => ({ id: x.user_id, name: [x.first_name, x.last_name].filter(Boolean).join(' ') || 'Слушатель', role: x.role }));
  }
  /** Stable invite token per playlist (created on first invite). */
  async playlistInviteToken(playlistId: number, fresh: string) {
    await this.db.query('UPDATE playlists SET invite_token = COALESCE(invite_token, $2) WHERE id=$1', [playlistId, fresh]);
    const r = await this.db.query<{ invite_token: string }>('SELECT invite_token FROM playlists WHERE id=$1', [playlistId]);
    return r.rows[0]!.invite_token;
  }
  async playlistByInvite(token: string) {
    const r = await this.db.query<{ id: number; title: string; owner: string; n: number; members: number }>(
      `SELECT p.id, p.title, u.first_name AS owner,
              (SELECT count(*)::int FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS n,
              (SELECT count(*)::int FROM playlist_members pm WHERE pm.playlist_id = p.id) AS members
       FROM playlists p JOIN users u ON u.id = p.user_id WHERE p.invite_token = $1`,
      [token],
    );
    return r.rows[0];
  }
  async joinPlaylist(playlistId: number, userId: number) {
    await this.db.query(`INSERT INTO playlist_members (playlist_id, user_id, role) VALUES ($1,$2,'editor') ON CONFLICT DO NOTHING`, [playlistId, userId]);
  }
  async leavePlaylist(playlistId: number, userId: number) {
    await this.db.query(`DELETE FROM playlist_members WHERE playlist_id=$1 AND user_id=$2 AND role <> 'owner'`, [playlistId, userId]);
  }
  async deletePlaylist(playlistId: number) {
    await this.db.query('DELETE FROM playlists WHERE id=$1', [playlistId]);
  }

  // ---------- search history ----------
  async addRecentSearch(userId: number, q: string) {
    await this.db.query(
      `INSERT INTO recent_searches (user_id, query) VALUES ($1,$2) ON CONFLICT (user_id, query) DO UPDATE SET created_at=now()`,
      [userId, q.slice(0, 120)],
    );
    await this.db.query(
      `DELETE FROM recent_searches WHERE user_id=$1 AND query NOT IN (SELECT query FROM recent_searches WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10)`,
      [userId],
    );
  }
  async recentSearches(userId: number) {
    const r = await this.db.query<{ query: string }>('SELECT query FROM recent_searches WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [userId]);
    return r.rows.map((x) => x.query);
  }
  async clearRecentSearches(userId: number) {
    await this.db.query('DELETE FROM recent_searches WHERE user_id=$1', [userId]);
  }

  // ---------- recognitions ----------
  async addRecognition(userId: number, r: { title: string; artist: string; album?: string; coverUrl?: string; matchedTrackId?: string; unavailableReason?: string; source: 'miniapp' | 'bot'; provider: string }) {
    const x = await this.db.query<{ id: number; created_at: Date | string }>(
      `INSERT INTO recognitions (user_id, title, artist, album, cover_url, matched_track_id, unavailable_reason, source, provider)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
      [userId, r.title, r.artist, r.album ?? null, r.coverUrl ?? null, r.matchedTrackId ?? null, r.unavailableReason ?? null, r.source, r.provider],
    );
    return { id: String(x.rows[0]!.id), createdAt: new Date(x.rows[0]!.created_at).toISOString() };
  }
  async recognitions(userId: number, limit = 30): Promise<(Omit<Recognition, 'track'> & { trackId?: string })[]> {
    const r = await this.db.query<{ id: number; title: string; artist: string; album: string | null; cover_url: string | null; matched_track_id: string | null; unavailable_reason: string | null; source: 'miniapp' | 'bot'; created_at: Date | string }>(
      'SELECT * FROM recognitions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      title: x.title,
      artist: x.artist,
      album: x.album ?? undefined,
      coverUrl: x.cover_url ?? undefined,
      trackId: x.matched_track_id ?? undefined,
      unavailableReason: x.unavailable_reason ?? undefined,
      source: x.source,
      createdAt: new Date(x.created_at).toISOString(),
    }));
  }
  async cachedRecognition(sha: string): Promise<unknown | undefined> {
    const r = await this.db.query<{ result: unknown }>(`SELECT result FROM recognition_cache WHERE audio_sha256=$1 AND created_at > now() - interval '30 days'`, [sha]);
    return r.rows[0]?.result;
  }
  async cacheRecognition(sha: string, result: unknown) {
    await this.db.query('INSERT INTO recognition_cache (audio_sha256, result) VALUES ($1,$2::jsonb) ON CONFLICT (audio_sha256) DO UPDATE SET result=EXCLUDED.result, created_at=now()', [sha, JSON.stringify(result)]);
  }

  // ---------- quotas ----------
  /** Atomically increments today's counter and returns the new value. */
  async bumpUsage(userId: number, kind: string): Promise<number> {
    const r = await this.db.query<{ count: number }>(
      `INSERT INTO usage_counters (user_id, kind, day, count) VALUES ($1,$2,CURRENT_DATE,1)
       ON CONFLICT (user_id, kind, day) DO UPDATE SET count = usage_counters.count + 1 RETURNING count`,
      [userId, kind],
    );
    return r.rows[0]!.count;
  }
  async usage(userId: number, kind: string): Promise<number> {
    const r = await this.db.query<{ count: number }>('SELECT count FROM usage_counters WHERE user_id=$1 AND kind=$2 AND day=CURRENT_DATE', [userId, kind]);
    return r.rows[0]?.count ?? 0;
  }
  async unbumpUsage(userId: number, kind: string) {
    await this.db.query('UPDATE usage_counters SET count = GREATEST(0, count - 1) WHERE user_id=$1 AND kind=$2 AND day=CURRENT_DATE', [userId, kind]);
  }

  // ---------- downloads ----------
  async recordDownload(userId: number, trackId: string, provider: string) {
    await this.db.query('INSERT INTO downloads (user_id, track_id, provider) VALUES ($1,$2,$3)', [userId, trackId, provider]);
  }
  async cachedFileId(trackId: string): Promise<string | undefined> {
    const r = await this.db.query<{ file_id: string }>('SELECT file_id FROM telegram_file_cache WHERE track_id=$1', [trackId]);
    return r.rows[0]?.file_id;
  }
  async cacheFileId(trackId: string, provider: string, fileId: string) {
    await this.db.query('INSERT INTO telegram_file_cache (track_id, provider, file_id) VALUES ($1,$2,$3) ON CONFLICT (track_id) DO UPDATE SET file_id=EXCLUDED.file_id', [trackId, provider, fileId]);
  }
  async dropFileId(trackId: string) {
    await this.db.query('DELETE FROM telegram_file_cache WHERE track_id=$1', [trackId]);
  }

  // ---------- privacy ----------
  async resetRecommendations(userId: number) {
    await this.db.query('DELETE FROM events WHERE user_id=$1', [userId]);
    await this.db.query('DELETE FROM dislikes WHERE user_id=$1', [userId]);
    await this.db.query(`UPDATE user_settings SET onboarding_genres='[]'::jsonb, onboarding_artists='[]'::jsonb WHERE user_id=$1`, [userId]);
    await this.db.query('UPDATE users SET onboarded=FALSE WHERE id=$1', [userId]);
  }
  /** Full erasure: cascades to every user table. */
  async deleteUser(userId: number) {
    await this.db.query('DELETE FROM users WHERE id=$1', [userId]);
  }
}
