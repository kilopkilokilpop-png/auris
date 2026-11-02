import type { FastifyInstance } from 'fastify';
import { WaveRequestSchema } from '@auris/shared';
import { userId, type Services } from '../app.js';

export function registerWaveRoutes(app: FastifyInstance, s: Services) {
  app.post('/api/wave/next', async (req) => {
    const uid = userId(req);
    const body = WaveRequestSchema.parse(req.body ?? {});
    await s.store.updateSettings(uid, { waveMood: body.mood, waveMode: body.mode });
    return { items: await s.wave.next(uid, body) };
  });
}
