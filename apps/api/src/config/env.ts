import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

/**
 * Every variable the backend (API + bot) reads. Keep in sync with .env.example —
 * `pnpm check:env` fails when they diverge.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  /** Public HTTPS origin of the API, used to build stream URLs. Empty = same origin as Mini App (proxy). */
  PUBLIC_API_URL: optionalStr,
  /** HTTPS URL of the Mini App, also the only allowed CORS origin. */
  MINI_APP_URL: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** postgres://… (Supabase works). Empty = embedded PGlite in DATA_DIR (dev only). */
  DATABASE_URL: optionalStr,
  DATA_DIR: z.string().default('.data'),

  /** Telegram bot token from @BotFather. Empty = bot features show "not configured". */
  BOT_TOKEN: optionalStr,
  BOT_USERNAME: optionalStr,
  BOT_PORT: z.coerce.number().int().default(3002),
  /** webhook (production) | polling (local convenience only) */
  BOT_MODE: z.enum(['webhook', 'polling']).default('webhook'),
  /** Public HTTPS base of the bot server; webhook is set to <url>/telegram/webhook */
  BOT_WEBHOOK_URL: optionalStr,
  WEBHOOK_SECRET: optionalStr,
  /** Shared secret for bot -> API internal calls. */
  INTERNAL_API_SECRET: optionalStr,
  INTERNAL_API_URL: z.string().default('http://127.0.0.1:3001'),
  /** Max age of Telegram initData, seconds. */
  INIT_DATA_MAX_AGE_SEC: z.coerce.number().int().default(86_400),
  /** Signing key for short-lived stream URLs. Generated per boot if empty. */
  STREAM_SIGNING_SECRET: optionalStr,
  /** Dev only: lets the Mini App run in a normal browser with a signed fake user. Ignored in production. */
  ALLOW_DEV_AUTH: bool(true),

  /** Comma list in priority order: mock, deezer, jamendo, licensed */
  MUSIC_PROVIDERS: z.string().default('mock'),
  DEEZER_ENABLED_NONCOMMERCIAL: bool(false),
  JAMENDO_CLIENT_ID: optionalStr,
  /** Jamendo terms forbid content caching beyond what is necessary; keep false unless licensed otherwise. */
  JAMENDO_CACHE_FILE_ID: bool(false),
  LICENSED_API_URL: optionalStr,
  LICENSED_API_KEY: optionalStr,
  /** Set only after the contract explicitly grants download/sending rights. */
  LICENSED_DOWNLOADS_CONTRACTED: bool(false),
  LICENSED_CACHE_FILE_ID: bool(false),

  /** mock | audd | acrcloud | comma list for fallback, e.g. "audd,acrcloud" */
  RECOGNITION_PROVIDERS: z.string().default('mock'),
  AUDD_API_TOKEN: optionalStr,
  ACRCLOUD_HOST: optionalStr,
  ACRCLOUD_ACCESS_KEY: optionalStr,
  ACRCLOUD_ACCESS_SECRET: optionalStr,
  FFMPEG_PATH: z.string().default('ffmpeg'),

  RECOGNITION_PER_DAY: z.coerce.number().int().default(30),
  RECOGNITION_PER_MINUTE: z.coerce.number().int().default(4),
  DOWNLOADS_PER_DAY: z.coerce.number().int().default(20),
  DOWNLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(240),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = EnvSchema.parse(source);
  if (env.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!env.DATABASE_URL) missing.push('DATABASE_URL');
    if (!env.BOT_TOKEN) missing.push('BOT_TOKEN');
    if (!env.INTERNAL_API_SECRET) missing.push('INTERNAL_API_SECRET');
    if (!env.STREAM_SIGNING_SECRET) missing.push('STREAM_SIGNING_SECRET');
    if (!env.MINI_APP_URL.startsWith('https://')) missing.push('MINI_APP_URL (https)');
    if (missing.length) throw new Error(`Missing production env: ${missing.join(', ')}`);
    env.ALLOW_DEV_AUTH = false;
  }
  return env;
}
