import type { FastifyInstance } from 'fastify';
import type { Recognition } from '@auris/shared';
import { userId, type Services } from '../app.js';
import { AppError } from '../lib/errors.js';

export function registerHearRoutes(app: FastifyInstance, s: Services) {
  /** multipart/form-data with one "audio" file (8–10 s from MediaRecorder). The audio is never stored. */
  app.post('/api/recognize', async (req) => {
    const uid = userId(req);
    const file = await req.file().catch(() => undefined);
    if (!file) throw new AppError('AUDIO_INVALID', 'Нет аудио в запросе', 400);
    // Kept in memory only for this request; never written to disk or logs.
    return s.recognition.recognize(uid, await file.toBuffer(), file.mimetype, 'miniapp');
  });

  app.get('/api/recognitions', async (req): Promise<{ items: Recognition[] }> => {
    const rows = await s.store.recognitions(userId(req));
    const ids = rows.map((r) => r.trackId).filter((x): x is string => !!x);
    const snaps = await s.store.snapshots(ids);
    return {
      items: rows.map(({ trackId, ...r }) => {
        // A match from a source that is no longer connected: keep the title, drop the play button.
        const track = trackId && s.music.owns(trackId) ? snaps.get(trackId) : undefined;
        return { ...r, track, unavailableReason: trackId && !track ? 'Этого трека больше нет в каталоге AURIS.' : r.unavailableReason };
      }),
    };
  });
}
