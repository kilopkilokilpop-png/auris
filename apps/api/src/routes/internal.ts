import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { TELEGRAM_GETFILE_MAX_BYTES, TrackIdSchema } from '@auris/shared';
import type { Services } from '../app.js';
import { AppError } from '../lib/errors.js';

const UserBody = z.object({ userId: z.number().int().positive() });

/** Bot -> API. Authenticated by a shared secret; never exposed through the Mini App proxy. */
export function registerInternalRoutes(app: FastifyInstance, s: Services) {
  const secret = s.env.INTERNAL_API_SECRET;
  const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  const guard = async (req: FastifyRequest) => {
    if (!secret) throw new AppError('UNAUTHORIZED', 'INTERNAL_API_SECRET не задан', 503);
    // Socket address, not req.ip: X-Forwarded-For must not be able to fake "local".
    if (s.env.INTERNAL_LOOPBACK_ONLY && !loopback.has(req.socket.remoteAddress ?? '')) throw new AppError('NOT_FOUND', 'Not found', 404);
    const given = Buffer.from(String(req.headers['x-internal-secret'] ?? ''));
    const want = Buffer.from(secret);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new AppError('UNAUTHORIZED', 'forbidden', 403);
  };

  app.register(async (r) => {
    r.addHook('onRequest', guard);

    r.post('/internal/users/touch', async (req) => {
      const b = z
        .object({ user: z.object({ id: z.number().int().positive(), first_name: z.string().optional(), last_name: z.string().optional(), username: z.string().optional() }), botStarted: z.boolean() })
        .parse(req.body);
      await s.store.touchUserFromBot(b.user, b.botStarted);
      return { ok: true };
    });

    r.get('/internal/search', async (req) => {
      const q = z.object({ q: z.string().trim().min(1).max(120), userId: z.coerce.number().int().positive() }).parse(req.query);
      const res = await s.music.search(q.q, { type: 'track', limit: 6 });
      await s.store.saveSnapshots(res.tracks);
      return { tracks: res.tracks };
    });

    r.get('/internal/likes', async (req) => {
      const { userId } = z.object({ userId: z.coerce.number().int().positive() }).parse(req.query);
      return { tracks: await s.catalog.hydrate(await s.store.likedIds(userId, 10)) };
    });

    r.post('/internal/likes', async (req) => {
      const b = UserBody.extend({ trackId: TrackIdSchema }).parse(req.body);
      const [t] = await s.catalog.hydrate([b.trackId]);
      if (!t) throw new AppError('NOT_FOUND', 'Трек не найден', 404);
      await s.store.like(b.userId, b.trackId);
      await s.store.addEvent(b.userId, { trackId: b.trackId, kind: 'like', artistId: t.artist.id, genres: t.genres, context: 'bot' });
      s.wave.invalidate(b.userId);
      return { ok: true };
    });

    r.post('/internal/download', async (req) => {
      const b = UserBody.extend({ trackId: TrackIdSchema }).parse(req.body);
      const t = await s.music.getTrack(b.trackId);
      if (!t) throw new AppError('NOT_FOUND', 'Трек не найден', 404);
      return s.downloads.send(b.userId, t);
    });

    r.post('/internal/recognize', async (req) => {
      const file = await req.file({ limits: { fileSize: TELEGRAM_GETFILE_MAX_BYTES } });
      if (!file) throw new AppError('AUDIO_INVALID', 'Нет аудио', 400);
      const uid = Number((file.fields.userId as { value?: string } | undefined)?.value);
      if (!Number.isInteger(uid) || uid <= 0) throw new AppError('BAD_REQUEST', 'userId', 400);
      return s.recognition.recognize(uid, await file.toBuffer(), file.mimetype, 'bot');
    });

    r.post('/internal/reset', async (req) => {
      const { userId } = UserBody.parse(req.body);
      await s.store.resetRecommendations(userId);
      s.wave.invalidate(userId);
      return { ok: true };
    });

    r.post('/internal/delete', async (req) => {
      const { userId } = UserBody.parse(req.body);
      await s.store.deleteUser(userId);
      s.wave.invalidate(userId);
      return { ok: true };
    });
  });
}
