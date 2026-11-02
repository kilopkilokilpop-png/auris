import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { playerQualityLine, QualityTierSchema, TrackIdSchema, type StreamInfo } from '@auris/shared';
import { userId, type Services } from '../app.js';
import { AppError } from '../lib/errors.js';
import { MockProvider } from '../providers/music/MockProvider.js';

const RANGE = /^bytes=(\d*)-(\d*)$/;

export function registerMediaRoutes(app: FastifyInstance, s: Services) {
  /** Returns a short-lived URL for <audio>. Upstream URLs and provider keys never reach the client. */
  app.get('/api/stream-url/:id', async (req): Promise<StreamInfo> => {
    const uid = userId(req);
    const { id } = z.object({ id: TrackIdSchema }).parse(req.params);
    const { quality } = z.object({ quality: QualityTierSchema.default('standard') }).parse(req.query);
    const track = await s.music.getTrack(id);
    if (!track) throw new AppError('NOT_FOUND', 'Трек не найден', 404);
    if (track.playback.kind === 'none') throw new AppError('NOT_FOUND', track.playback.note ?? 'Трек нельзя послушать в AURIS', 404);
    const { token, exp } = s.signer.sign({ t: id, q: quality, u: uid });
    return {
      url: `${s.env.PUBLIC_API_URL ?? ''}/api/stream/${token}`,
      kind: track.playback.kind,
      playableSec: track.playback.playableSec,
      qualityLine: playerQualityLine(track, quality),
      expiresAt: exp,
    };
  });

  app.get('/api/stream/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().max(1024) }).parse(req.params);
    const claims = s.signer.verify(token);
    if (!claims) throw new AppError('UNAUTHORIZED', 'Ссылка на поток устарела', 401);
    const src = await s.music.getStream(claims.t, claims.q);
    if (!src) throw new AppError('NOT_FOUND', 'Поток недоступен', 404);
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    void reply.header('cache-control', 'private, max-age=3600').header('accept-ranges', 'bytes').header('x-auris-playback', src.kind);

    if (src.filePath) {
      const size = fs.statSync(src.filePath).size;
      const m = range ? RANGE.exec(range) : null;
      void reply.type(src.mime);
      if (m) {
        let start = m[1] ? Number(m[1]) : size - Number(m[2]);
        let end = m[1] && m[2] ? Number(m[2]) : size - 1;
        if (!m[1]) end = size - 1;
        start = Math.max(0, start);
        end = Math.min(size - 1, end);
        if (start > end) return reply.status(416).header('content-range', `bytes */${size}`).send();
        return reply
          .status(206)
          .header('content-range', `bytes ${start}-${end}/${size}`)
          .header('content-length', end - start + 1)
          .send(fs.createReadStream(src.filePath, { start, end }));
      }
      return reply.header('content-length', size).send(fs.createReadStream(src.filePath));
    }

    const upstream = await fetch(src.url, { headers: range ? { range } : {}, signal: AbortSignal.timeout(30_000) });
    if (!upstream.ok || !upstream.body) throw new AppError('PROVIDER_UNAVAILABLE', 'Источник потока недоступен', 502);
    for (const h of ['content-type', 'content-length', 'content-range']) {
      const v = upstream.headers.get(h);
      if (v) void reply.header(h, v);
    }
    return reply.status(upstream.status).send(Readable.fromWeb(upstream.body as never));
  });

  app.get('/api/media/cover/:id', async (req, reply) => {
    const { id } = z.object({ id: TrackIdSchema }).parse(req.params);
    const { format } = z.object({ format: z.enum(['svg', 'jpg']).default('svg') }).parse(req.query);
    const p = s.music.byId(id);
    if (!(p instanceof MockProvider)) throw new AppError('NOT_FOUND', 'Обложка не найдена', 404);
    const file = await p.coverFile(id, format);
    if (!file) throw new AppError('NOT_FOUND', 'Обложка не найдена', 404);
    return reply.type(format === 'svg' ? 'image/svg+xml' : 'image/jpeg').header('cache-control', 'public, max-age=86400').send(fs.createReadStream(file));
  });
}
