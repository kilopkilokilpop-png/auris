import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../app.js';
import { signInitData } from '../auth/initData.js';

/** Used only when BOT_TOKEN is empty in development. Never enabled in production. */
export const DEV_BOT_TOKEN = '0:AURIS-DEV-ONLY-TOKEN';

/**
 * Dev login for running the Mini App in a normal browser: returns initData signed exactly like
 * Telegram does, so the server-side signature check is exercised on every request.
 */
export function registerDevRoutes(app: FastifyInstance, s: Services) {
  app.get('/api/dev/init-data', async (req) => {
    const q = z
      .object({ id: z.coerce.number().int().positive().default(100_001), name: z.string().max(32).default('Алекс'), last: z.string().max(32).default('Морозов'), master: z.enum(['0', '1']).optional() })
      .parse(req.query);
    const user = { id: q.id, first_name: q.name, last_name: q.last, username: 'auris_demo', language_code: 'ru' };
    await s.store.upsertUser(user);
    if (q.master) await s.store.db.query('UPDATE users SET is_master=$2 WHERE id=$1', [q.id, q.master === '1']);
    return { initData: signInitData(user, s.env.BOT_TOKEN ?? DEV_BOT_TOKEN), botUsername: s.env.BOT_USERNAME ?? null };
  });
}
