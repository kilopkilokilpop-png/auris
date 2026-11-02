import crypto from 'node:crypto';
import Fastify from 'fastify';
import { webhookCallback } from 'grammy';
import { HttpAurisApi } from './api-client.js';
import { configureBot, createBot } from './bot.js';
import { loadBotEnv } from './env.js';

const env = loadBotEnv();
const server = Fastify({ logger: { level: env.LOG_LEVEL } });
server.get('/health', async () => ({ ok: true, configured: !!env.BOT_TOKEN }));

if (!env.BOT_TOKEN) {
  server.log.warn('BOT_TOKEN is empty — the bot is disabled. The Mini App still works in the browser with demo data.');
  await server.listen({ port: env.BOT_PORT, host: '0.0.0.0' });
} else {
  if (!env.INTERNAL_API_SECRET) throw new Error('INTERNAL_API_SECRET is required when BOT_TOKEN is set');
  const api = new HttpAurisApi(env.INTERNAL_API_URL, env.INTERNAL_API_SECRET);
  const bot = createBot(api, { token: env.BOT_TOKEN, miniAppUrl: env.MINI_APP_URL });
  await bot.init();
  await configureBot(bot, env.MINI_APP_URL).catch((e: Error) => server.log.warn({ err: e.message }, 'configureBot failed'));

  if (env.BOT_MODE === 'webhook') {
    if (!env.BOT_WEBHOOK_URL) throw new Error('BOT_WEBHOOK_URL is required in webhook mode');
    const secret = env.WEBHOOK_SECRET ?? crypto.randomBytes(24).toString('hex');
    // grammY rejects updates whose X-Telegram-Bot-Api-Secret-Token header does not match.
    server.post('/telegram/webhook', webhookCallback(bot, 'fastify', { secretToken: secret }));
    await server.listen({ port: env.BOT_PORT, host: '0.0.0.0' });
    const url = env.BOT_WEBHOOK_URL.replace(/\/$/, '') + '/telegram/webhook';
    await bot.api.setWebhook(url, { secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
    server.log.info({ url, bot: bot.botInfo.username }, 'webhook set');
  } else {
    await server.listen({ port: env.BOT_PORT, host: '0.0.0.0' });
    await bot.api.deleteWebhook();
    server.log.info({ bot: bot.botInfo.username }, 'long polling (local development only)');
    void bot.start({ allowed_updates: ['message', 'callback_query'] });
  }
  const stop = async () => {
    if (env.BOT_MODE === 'polling') await bot.stop();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
