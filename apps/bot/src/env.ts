import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

const optional = z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined));

export const BotEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BOT_TOKEN: optional,
  BOT_USERNAME: optional,
  BOT_PORT: z.coerce.number().int().default(3002),
  BOT_MODE: z.enum(['webhook', 'polling']).default('webhook'),
  BOT_WEBHOOK_URL: optional,
  WEBHOOK_SECRET: optional,
  MINI_APP_URL: z.string().default('http://localhost:5173'),
  INTERNAL_API_URL: z.string().default('http://127.0.0.1:3001'),
  INTERNAL_API_SECRET: optional,
  LOG_LEVEL: z.string().default('info'),
});
export type BotEnv = z.infer<typeof BotEnvSchema>;

export function loadBotEnv(): BotEnv {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  config({ path: path.join(root, '.env'), quiet: true });
  return BotEnvSchema.parse(process.env);
}
