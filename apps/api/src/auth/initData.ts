import crypto from 'node:crypto';
import { z } from 'zod';

export const TelegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().default(''),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  photo_url: z.string().optional(),
  is_bot: z.boolean().optional(),
});
export type TelegramUser = z.infer<typeof TelegramUserSchema>;

export class InitDataError extends Error {}

/**
 * Validates Telegram Mini App initData per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * secret = HMAC_SHA256("WebAppData", bot_token); hash = HMAC_SHA256(secret, data_check_string)
 */
export function validateInitData(raw: string, botToken: string, maxAgeSec: number, now = Date.now()): TelegramUser {
  if (!raw || raw.length > 8192) throw new InitDataError('initData missing');
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new InitDataError('hash missing');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new InitDataError('bad signature');
  }
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) throw new InitDataError('auth_date missing');
  if (maxAgeSec > 0 && now / 1000 - authDate > maxAgeSec) throw new InitDataError('initData expired');
  const userRaw = params.get('user');
  if (!userRaw) throw new InitDataError('user missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(userRaw);
  } catch {
    throw new InitDataError('user malformed');
  }
  const user = TelegramUserSchema.safeParse(parsed);
  if (!user.success || user.data.is_bot) throw new InitDataError('user invalid');
  return user.data;
}

/** Produces initData signed with `botToken`. Used by tests and the dev-only browser login. */
export function signInitData(user: TelegramUser, botToken: string, authDate = Math.floor(Date.now() / 1000)): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAH' + crypto.randomBytes(8).toString('hex'));
  params.set('user', JSON.stringify(user));
  // Real clients also send an Ed25519 `signature` (for third-party validation); it is part of the
  // data-check-string. Dev/test data carries a placeholder — we validate via `hash` + bot token.
  params.set('signature', crypto.randomBytes(48).toString('base64url'));
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}
