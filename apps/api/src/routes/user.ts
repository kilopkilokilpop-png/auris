import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { OnboardingSubmitSchema, PlaylistAddSchema, PlaylistCreateSchema, PlaylistJoinSchema, PostEventSchema, SettingsPatchSchema, TrackIdSchema, type Playlist, type PlaylistDetail } from '@auris/shared';
import { userId, type Services } from '../app.js';
import { AppError } from '../lib/errors.js';

const IdParam = z.object({ id: TrackIdSchema });

export function registerUserRoutes(app: FastifyInstance, s: Services) {
  app.get('/api/me', async (req) => {
    const p = await s.store.getProfile(userId(req));
    if (!p) throw new AppError('NOT_FOUND', 'Профиль не найден', 404);
    return p;
  });

  app.patch('/api/me/settings', async (req) => {
    const id = userId(req);
    const body = SettingsPatchSchema.parse(req.body);
    await s.store.updateSettings(id, body);
    return s.store.getProfile(id);
  });

  app.post('/api/me/reset-recommendations', async (req) => {
    const id = userId(req);
    await s.store.resetRecommendations(id);
    s.wave.invalidate(id);
    return { ok: true };
  });

  app.delete('/api/me', async (req) => {
    const id = userId(req);
    await s.store.deleteUser(id);
    s.wave.invalidate(id);
    return { ok: true };
  });

  // ---------- onboarding ----------
  app.get('/api/onboarding', async () => {
    const [genres, artists] = await Promise.all([s.music.getGenres(), s.music.getChartArtists(18)]);
    return { genres: genres.slice(0, 16), artists };
  });
  app.post('/api/onboarding', async (req) => {
    const id = userId(req);
    const body = OnboardingSubmitSchema.parse(req.body);
    await s.store.setOnboarding(id, body.genres, body.artists);
    s.wave.invalidate(id);
    return s.store.getProfile(id);
  });

  // ---------- events ----------
  app.post('/api/events', async (req) => {
    const id = userId(req);
    const e = PostEventSchema.parse(req.body);
    const [track] = await s.catalog.hydrate([e.trackId]);
    await s.store.addEvent(id, {
      trackId: e.trackId,
      kind: e.kind,
      artistId: track?.artist.id,
      genres: track?.genres,
      positionSec: e.positionSec,
      durationSec: track?.playback.playableSec,
      listenedSec: e.listenedSec,
      context: e.context,
    });
    return { ok: true };
  });

  // ---------- likes ----------
  app.get('/api/likes', async (req) => {
    const ids = await s.store.likedIds(userId(req));
    return { tracks: await s.catalog.hydrate(ids) };
  });
  app.get('/api/likes/ids', async (req) => ({ ids: await s.store.likedIds(userId(req), 2000) }));

  const feedback = async (uid: number, trackId: string, kind: 'like' | 'unlike' | 'dislike') => {
    const [track] = await s.catalog.hydrate([trackId]);
    if (!track) throw new AppError('NOT_FOUND', 'Трек не найден', 404);
    if (kind === 'like') await s.store.like(uid, trackId);
    if (kind === 'unlike') await s.store.unlike(uid, trackId);
    if (kind === 'dislike') await s.store.dislike(uid, trackId, track.artist.id);
    await s.store.addEvent(uid, { trackId, kind, artistId: track.artist.id, genres: track.genres });
    // Takes effect on the very next /api/wave/next call.
    s.wave.invalidate(uid);
    return { ok: true };
  };
  app.post('/api/likes/:id', async (req) => feedback(userId(req), IdParam.parse(req.params).id, 'like'));
  app.delete('/api/likes/:id', async (req) => feedback(userId(req), IdParam.parse(req.params).id, 'unlike'));
  app.post('/api/dislikes/:id', async (req) => feedback(userId(req), IdParam.parse(req.params).id, 'dislike'));

  // ---------- albums ----------
  app.get('/api/albums/liked', async (req) => ({ albums: await s.store.likedAlbums(userId(req)) }));
  app.post('/api/albums/:id/like', async (req) => {
    const { id } = IdParam.parse(req.params);
    const album = await s.music.getAlbum(id);
    if (!album) throw new AppError('NOT_FOUND', 'Альбом не найден', 404);
    await s.store.likeAlbum(userId(req), id, { ...album, tracks: undefined });
    return { ok: true };
  });
  app.delete('/api/albums/:id/like', async (req) => {
    await s.store.unlikeAlbum(userId(req), IdParam.parse(req.params).id);
    return { ok: true };
  });

  // ---------- playlists (shared) ----------
  const toPlaylist = async (r: { id: number; title: string; created_at: Date | string; n: number; first: string | null; role: 'owner' | 'editor'; members: number }): Promise<Playlist> => {
    const cover = r.first ? (await s.store.snapshots([r.first])).get(r.first)?.coverUrl : undefined;
    return { id: String(r.id), title: r.title, trackCount: r.n, coverUrl: cover, createdAt: new Date(r.created_at).toISOString(), role: r.role, memberCount: r.members };
  };
  const access = async (uid: number, pid: number) => {
    const pl = await s.store.playlistAccess(uid, pid);
    // Non-members get the same answer as for a missing playlist.
    if (!pl) throw new AppError('NOT_FOUND', 'Плейлист не найден', 404);
    return pl;
  };
  const inviteLink = (token: string) =>
    s.env.BOT_USERNAME ? `https://t.me/${s.env.BOT_USERNAME}?start=pl_${token}` : `${s.env.MINI_APP_URL.replace(/\/$/, '')}/?join=${token}`;

  app.get('/api/playlists', async (req) => ({ playlists: await Promise.all((await s.store.playlists(userId(req))).map(toPlaylist)) }));
  app.post('/api/playlists', async (req) => {
    const { title } = PlaylistCreateSchema.parse(req.body);
    const id = await s.store.createPlaylist(userId(req), title);
    return { id: String(id) };
  });
  const PlParam = z.object({ pid: z.coerce.number().int().positive() });

  app.get('/api/playlists/invite/:token', async (req) => {
    userId(req);
    const { token } = PlaylistJoinSchema.parse(req.params);
    const pl = await s.store.playlistByInvite(token);
    if (!pl) throw new AppError('NOT_FOUND', 'Приглашение недействительно', 404);
    return { title: pl.title, owner: pl.owner, trackCount: pl.n, memberCount: pl.members };
  });
  app.post('/api/playlists/join', async (req) => {
    const uid = userId(req);
    const { token } = PlaylistJoinSchema.parse(req.body);
    const pl = await s.store.playlistByInvite(token);
    if (!pl) throw new AppError('NOT_FOUND', 'Приглашение недействительно', 404);
    await s.store.joinPlaylist(pl.id, uid);
    return { id: String(pl.id), title: pl.title };
  });

  app.get('/api/playlists/:pid', async (req): Promise<PlaylistDetail> => {
    const uid = userId(req);
    const { pid } = PlParam.parse(req.params);
    const pl = await access(uid, pid);
    const rows = await s.store.playlistTracks(pid);
    return {
      id: String(pl.id),
      title: pl.title,
      role: pl.role,
      members: await s.store.playlistMembers(pid),
      tracks: await s.catalog.hydrate(rows.map((r) => r.track_id)),
      addedBy: Object.fromEntries(rows.map((r) => [r.track_id, r.added_by])),
    };
  });
  app.post('/api/playlists/:pid/tracks', async (req) => {
    const uid = userId(req);
    const { pid } = PlParam.parse(req.params);
    const { trackId } = PlaylistAddSchema.parse(req.body);
    await access(uid, pid);
    const [track] = await s.catalog.hydrate([trackId]);
    if (!track) throw new AppError('NOT_FOUND', 'Трек не найден', 404);
    await s.store.addToPlaylist(pid, trackId, uid);
    await s.store.addEvent(uid, { trackId, kind: 'playlist_add', artistId: track.artist.id, genres: track.genres });
    s.wave.invalidate(uid);
    return { ok: true };
  });
  app.delete('/api/playlists/:pid/tracks/:id', async (req) => {
    const uid = userId(req);
    const { pid } = PlParam.parse(req.params);
    const { id } = IdParam.parse(req.params);
    const pl = await access(uid, pid);
    const row = (await s.store.playlistTracks(pid)).find((r) => r.track_id === id);
    if (!row) throw new AppError('NOT_FOUND', 'Трека нет в плейлисте', 404);
    // Owner removes anything; members remove what they added.
    if (pl.role !== 'owner' && row.added_by !== uid) throw new AppError('UNAUTHORIZED', 'Убрать этот трек может только тот, кто его добавил, или владелец', 403);
    await s.store.removeFromPlaylist(pid, id);
    return { ok: true };
  });
  app.post('/api/playlists/:pid/invite', async (req) => {
    const uid = userId(req);
    const { pid } = PlParam.parse(req.params);
    await access(uid, pid);
    const token = await s.store.playlistInviteToken(pid, crypto.randomBytes(12).toString('base64url'));
    return { token, link: inviteLink(token) };
  });
  /** Owner deletes the playlist for everyone; a member leaves it. */
  app.delete('/api/playlists/:pid', async (req) => {
    const uid = userId(req);
    const { pid } = PlParam.parse(req.params);
    const pl = await access(uid, pid);
    if (pl.role === 'owner') await s.store.deletePlaylist(pid);
    else await s.store.leavePlaylist(pid, uid);
    return { ok: true, deleted: pl.role === 'owner' };
  });
}
