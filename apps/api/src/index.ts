import { buildApp } from './app.js';
import { loadEnv } from './config/load.js';
import { openDb } from './db/index.js';
import { ffmpegAvailable } from './lib/ffmpeg.js';
import { MockProvider } from './providers/music/MockProvider.js';
import { createMusicProvider } from './providers/music/registry.js';
import { createRecognition } from './providers/recognition/registry.js';
import { GrammyTelegramSender } from './services/telegram.js';

const env = loadEnv();
const db = await openDb(env);
const music = createMusicProvider(env);
const recognition = createRecognition(env);
const hasFfmpeg = await ffmpegAvailable(env.FFMPEG_PATH);
const sender = env.BOT_TOKEN ? new GrammyTelegramSender(env.BOT_TOKEN) : null;

const { app } = await buildApp({ env, db, music, recognition, sender, hasFfmpeg });
await app.listen({ port: env.API_PORT, host: env.API_HOST });
app.log.info(
  { db: db.kind, providers: music.providers.map((p) => p.info.id), recognition: recognition.name, ffmpeg: hasFfmpeg, bot: !!sender },
  'AURIS API ready',
);
if (!hasFfmpeg) app.log.warn('ffmpeg not found: demo audio cannot be generated and uploads are sent to recognition as-is');

for (const p of music.providers) {
  if (p instanceof MockProvider && hasFfmpeg) void p.warmup().catch((e: Error) => app.log.warn({ err: e.message }, 'mock audio warmup failed'));
}

const stop = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
