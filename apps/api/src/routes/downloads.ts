import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TrackIdSchema } from '@auris/shared';
import { userId, type Services } from '../app.js';
import { AppError } from '../lib/errors.js';

export function registerDownloadRoutes(app: FastifyInstance, s: Services) {
  app.get('/api/downloads/check/:id', async (req) => {
    userId(req);
    const { id } = z.object({ id: TrackIdSchema }).parse(req.params);
    const d = await s.downloads.check(id);
    return d.allowed ? { allowed: true } : { allowed: false, reason: d.reason };
  });

  /** The server decides per track, every time. A direct call for a forbidden track gets 403. */
  app.post('/api/downloads', async (req) => {
    const uid = userId(req);
    const { trackId } = z.object({ trackId: TrackIdSchema }).parse(req.body);
    const track = await s.music.getTrack(trackId);
    if (!track) throw new AppError('NOT_FOUND', 'Трек не найден', 404);
    return s.downloads.send(uid, track);
  });
}
