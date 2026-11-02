import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OnboardingSubmitSchema, PlaylistAddSchema, PlaylistCreateSchema, PostEventSchema, SettingsPatchSchema, TrackIdSchema, type Playlist } from '@auris/shared';
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

  // ---------- playlists ----------
  const toPlaylist = async (r: { id: number; title: string; created_at: Date | string; n: number; first: string | null }): Promise<Playlist> => {
    const cover = r.first ? (await s.store.snapshots([r.first])).get(r.first)?.coverUrl : undefined;
    return { id: String(r.id), title: r.title, trackCount: r.n, coverUrl: cover, createdAt: new Date(r.created_at).toISOString() };
  };
  app.get('/api/playlists', async (req) => ({ playlists: await Promise.all((await s.store.playlists(userId(req))).map(toPlaylist)) }));
  app.post('/api/playlists', async (req) => {
    const { title } = PlaylistCreateSchema.parse(req.body);
    const id = await s.store.createPlaylist(userId(req), title);
    return { id: String(id) };
  });
  const PlParam = z.object({ pid: z.coerce.number().int().positive() });
  app.get('/api/playlists/:pid', async (req) => {
    const { pid } = PlParam.parse(req.params);
    const pl = await s.store.playlistOwned(userId(req), pid);
    if (!pl) throw new AppError('NOT_FOUND', 'Плейлист не найден', 404);
    return { id: String(pl.id), title: pl.title, tracks: await s.catalog.hydrate(await s.store.playlistTrackIds(pid)) };
  });
  app.post('/api/playlists/:pid/tracks', async (req) => {
    const uid = userId(req);
    const { pid } = PlParam.parse(req.params);
    const { trackId } = PlaylistAddSchema.parse(req.body);
    if (!(await s.store.playlistOwned(uid, pid))) throw new AppError('NOT_FOUND', 'Плейлист не найден', 404);
    const [track] = await s.catalog.hydrate([trackId]);
    if (!track) throw new AppError('NOT_FOUND', 'Трек не найден', 404);
    await s.store.addToPlaylist(pid, trackId);
    await s.store.addEvent(uid, { trackId, kind: 'playlist_add', artistId: track.artist.id, genres: track.genres });
    s.wave.invalidate(uid);
    return { ok: true };
  });
}
