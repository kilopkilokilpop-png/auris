import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { RECOGNITION_MAX_BYTES, type ApiError } from '@auris/shared';
import { InitDataError, validateInitData, type TelegramUser } from './auth/initData.js';
import type { Env } from './config/env.js';
import type { Db } from './db/db.js';
import { AppError } from './lib/errors.js';
import type { CompositeProvider } from './providers/music/registry.js';
import type { RecognitionProvider } from './providers/recognition/RecognitionProvider.js';
import { Catalog } from './services/catalog.js';
import { MockProvider } from './providers/music/MockProvider.js';
import { DownloadService } from './services/downloads.js';
import { RecognitionService } from './services/recognition.js';
import { Store } from './services/store.js';
import { StreamSigner } from './services/streamToken.js';
import type { TelegramSender } from './services/telegram.js';
import { WaveService } from './services/wave.js';
import { registerUserRoutes } from './routes/user.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerWaveRoutes } from './routes/wave.js';
import { registerHearRoutes } from './routes/hear.js';
import { registerDownloadRoutes } from './routes/downloads.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerDevRoutes, DEV_BOT_TOKEN } from './routes/dev.js';

declare module 'fastify' {
  interface FastifyRequest {
    tgUser: TelegramUser | null;
  }
}

export interface AppDeps {
  env: Env;
  db: Db;
  music: CompositeProvider;
  recognition: RecognitionProvider;
  sender: TelegramSender | null;
  hasFfmpeg: boolean;
}

export interface Services {
  env: Env;
  store: Store;
  music: CompositeProvider;
  catalog: Catalog;
  wave: WaveService;
  signer: StreamSigner;
  downloads: DownloadService;
  recognition: RecognitionService;
}

const PUBLIC_PREFIXES = ['/api/health', '/api/public-config', '/api/stream/', '/api/media/', '/api/dev/', '/internal/'];

export function userId(req: FastifyRequest): number {
  if (!req.tgUser) throw new AppError('UNAUTHORIZED', 'Нет авторизации Telegram', 401);
  return req.tgUser.id;
}

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; services: Services }> {
  const { env } = deps;
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            // Never log auth headers, query tokens or bodies (audio!).
            redact: ['req.headers.authorization', 'req.headers["x-internal-secret"]'],
            serializers: {
              req: (r: FastifyRequest) => ({ method: r.method, url: r.url.replace(/\/api\/stream\/[^?]+/, '/api/stream/<token>') }),
            },
          },
    bodyLimit: 64 * 1024,
    routerOptions: { maxParamLength: 1024 },
    trustProxy: true,
  });

  const store = new Store(deps.db, deps.music.providers.map((p) => p.info.id));
  const catalog = new Catalog(deps.music, store);
  const services: Services = {
    env,
    store,
    music: deps.music,
    catalog,
    wave: new WaveService(deps.music, store, catalog),
    signer: new StreamSigner(env.STREAM_SIGNING_SECRET),
    downloads: new DownloadService({
      music: deps.music,
      store,
      sender: deps.sender,
      botUsername: env.BOT_USERNAME,
      perDay: env.DOWNLOADS_PER_DAY,
      concurrency: env.DOWNLOAD_CONCURRENCY,
      ffmpeg: env.FFMPEG_PATH,
      localCover: async (url) => {
        const m = /^\/api\/media\/cover\/(.+)$/.exec(url);
        const p = m ? deps.music.byId(decodeURIComponent(m[1]!)) : undefined;
        return p instanceof MockProvider ? p.coverFile(decodeURIComponent(m![1]!), 'jpg') : null;
      },
    }),
    recognition: new RecognitionService({
      provider: deps.recognition,
      music: deps.music,
      store,
      ffmpeg: env.FFMPEG_PATH,
      hasFfmpeg: deps.hasFfmpeg,
      perDay: env.RECOGNITION_PER_DAY,
      perMinute: env.RECOGNITION_PER_MINUTE,
    }),
  };

  const miniAppOrigin = new URL(env.MINI_APP_URL).origin;
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || origin === miniAppOrigin),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    max: env.API_RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Bucket by Telegram user when present (signature is checked later), else by IP.
      const h = req.headers.authorization;
      const m = h && /user=([^&]+)/.exec(h);
      if (m) {
        try {
          const id = (JSON.parse(decodeURIComponent(m[1]!)) as { id?: number }).id;
          if (id) return `u:${id}`;
        } catch {
          /* fall through */
        }
      }
      return `ip:${req.ip}`;
    },
    allowList: (req) => req.url.startsWith('/internal/') || req.url.startsWith('/telegram/') || req.url.startsWith('/api/stream/') || req.url.startsWith('/api/media/'),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: 'Слишком много запросов, подождите немного', retryAfterSec: Math.ceil(ctx.ttl / 1000) },
    }),
  });
  await app.register(multipart, { limits: { fileSize: RECOGNITION_MAX_BYTES, files: 1, fields: 4, parts: 6 } });

  const verifyToken = env.BOT_TOKEN ?? (env.ALLOW_DEV_AUTH ? DEV_BOT_TOKEN : undefined);
  const seen = new Map<number, number>();
  app.decorateRequest('tgUser', null);
  app.addHook('onRequest', async (req) => {
    const url = req.url;
    if (!url.startsWith('/api/') || PUBLIC_PREFIXES.some((p) => url.startsWith(p))) return;
    const h = req.headers.authorization ?? '';
    if (!h.startsWith('tma ')) throw new AppError('UNAUTHORIZED', 'Откройте AURIS из Telegram', 401);
    if (!verifyToken) throw new AppError('UNAUTHORIZED', 'Сервер не настроен: нет BOT_TOKEN', 401);
    try {
      req.tgUser = validateInitData(h.slice(4), verifyToken, env.INIT_DATA_MAX_AGE_SEC);
    } catch (e) {
      if (e instanceof InitDataError) throw new AppError('UNAUTHORIZED', 'Подпись Telegram недействительна или устарела. Перезапустите Mini App.', 401);
      throw e;
    }
    const last = seen.get(req.tgUser.id) ?? 0;
    if (Date.now() - last > 10 * 60_000) {
      await store.upsertUser(req.tgUser);
      seen.set(req.tgUser.id, Date.now());
    }
  });

  app.setErrorHandler((raw: Error, req, reply) => {
    const err = raw as Error & { statusCode?: number; code?: string };
    let body: ApiError;
    let status = 500;
    if (err instanceof AppError) {
      status = err.statusCode;
      body = { error: { code: err.code, message: err.message, ...err.extra } };
    } else if (err instanceof ZodError) {
      status = 400;
      body = { error: { code: 'BAD_REQUEST', message: 'Некорректный запрос: ' + err.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ') } };
    } else if (err.statusCode === 429) {
      status = 429;
      body = { error: { code: 'RATE_LIMITED', message: 'Слишком много запросов' } };
    } else if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.statusCode === 413) {
      status = 413;
      body = { error: { code: 'AUDIO_INVALID', message: 'Файл слишком большой' } };
    } else if (err.statusCode && err.statusCode < 500) {
      status = err.statusCode;
      body = { error: { code: status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', message: err.message } };
    } else if (err.name === 'UpstreamError') {
      status = 502;
      body = { error: { code: 'PROVIDER_UNAVAILABLE', message: 'Музыкальный сервис временно недоступен' } };
    } else {
      req.log.error({ err: { message: err.message, stack: err.stack } }, 'unhandled');
      body = { error: { code: 'INTERNAL', message: 'Внутренняя ошибка' } };
    }
    void reply.status(status).send(body);
  });

  app.get('/api/health', async () => ({ ok: true, providers: deps.music.providers.map((p) => p.info.id), recognition: deps.recognition.name }));
  // Public, non-secret runtime config for the Mini App (so the bundle needs no build-time vars).
  app.get('/api/public-config', async () => ({ botUsername: env.BOT_USERNAME ?? null }));

  registerUserRoutes(app, services);
  registerCatalogRoutes(app, services);
  registerMediaRoutes(app, services);
  registerWaveRoutes(app, services);
  registerHearRoutes(app, services);
  registerDownloadRoutes(app, services);
  registerInternalRoutes(app, services);
  if (env.ALLOW_DEV_AUTH && env.NODE_ENV !== 'production') registerDevRoutes(app, services);

  return { app, services };
}
