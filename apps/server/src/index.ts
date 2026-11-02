/**
 * Production "all-in-one" server for single-service hosting (Render, Railway, Fly, a VPS):
 *   https://<host>/            -> Mini App (apps/mini-app/dist)
 *   https://<host>/api/*        -> API
 *   https://<host>/telegram/webhook -> bot (grammY, secret-token checked)
 * The bot talks to the API over loopback; /internal/* refuses non-local connections.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { webhookCallback } from 'grammy';
import { createApi, loadEnv } from '@auris/api/server';
import { HttpAurisApi } from '@auris/bot/api-client';
import { configureBot, createBot } from '@auris/bot/bot';

// Hosting platforms give us the port and the public URL.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
const publicUrl = (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? process.env.MINI_APP_URL ?? '').replace(/\/$/, '');
process.env.MINI_APP_URL ??= publicUrl;
if (!process.env.MINI_APP_URL) process.env.MINI_APP_URL = publicUrl;
process.env.API_PORT = String(port);
process.env.INTERNAL_API_URL = `http://127.0.0.1:${port}`;
process.env.INTERNAL_LOOPBACK_ONLY ??= 'true';
process.env.DATA_DIR ??= '/tmp/auris';

const env = loadEnv();
const api = await createApi(env);
const { app } = api;

// ---------- Mini App static files ----------
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../mini-app/dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`Mini App build not found at ${dist} — run pnpm build`);
await app.register(fastifyStatic, {
  root: dist,
  prefix: '/',
  wildcard: false,
  setHeaders: (res, file) => {
    void res.header('cache-control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  },
});
const indexHtml = fs.readFileSync(path.join(dist, 'index.html'));
app.setNotFoundHandler((req, reply) => {
  if (req.method === 'GET' && !/^\/(api|internal|telegram)\//.test(req.url)) {
    return reply.type('text/html').header('cache-control', 'no-cache').send(indexHtml);
  }
  return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
});

// ---------- Bot webhook ----------
let bot: ReturnType<typeof createBot> | null = null;
// Telegram allows only [A-Za-z0-9_-]{1,256}; platform-generated secrets may contain other chars.
const rawSecret = env.WEBHOOK_SECRET ?? env.INTERNAL_API_SECRET ?? crypto.randomBytes(24).toString('hex');
const webhookSecret = /^[A-Za-z0-9_-]{1,256}$/.test(rawSecret) ? rawSecret : crypto.createHash('sha256').update(rawSecret).digest('hex');
if (env.BOT_TOKEN && env.INTERNAL_API_SECRET) {
  bot = createBot(new HttpAurisApi(env.INTERNAL_API_URL, env.INTERNAL_API_SECRET), { token: env.BOT_TOKEN, miniAppUrl: env.MINI_APP_URL });
  await bot.init();
  app.post('/telegram/webhook', webhookCallback(bot, 'fastify', { secretToken: webhookSecret }));
} else {
  app.log.warn('BOT_TOKEN or INTERNAL_API_SECRET missing — bot disabled');
}

await app.listen({ port, host: '0.0.0.0' });
api.afterListen();

if (bot) {
  const hookBase = (env.BOT_WEBHOOK_URL ?? publicUrl).replace(/\/$/, '');
  if (process.env.SKIP_TELEGRAM_SETUP === 'true') {
    app.log.warn('SKIP_TELEGRAM_SETUP: webhook and menu button not touched');
  } else if (hookBase.startsWith('https://')) {
    await bot.api.setWebhook(`${hookBase}/telegram/webhook`, { secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'] });
    app.log.info({ bot: bot.botInfo.username, webhook: `${hookBase}/telegram/webhook` }, 'webhook set');
  } else {
    app.log.warn('No public HTTPS URL — webhook not set');
  }
  if (process.env.SKIP_TELEGRAM_SETUP !== 'true') await configureBot(bot, env.MINI_APP_URL).catch((e: Error) => app.log.warn({ err: e.message }, 'configureBot failed'));
}

const stop = async () => {
  await api.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
