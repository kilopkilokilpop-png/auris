import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../app.js';
import { signInitData } from '../auth/initData.js';
import { parseEnv, type Env } from '../config/env.js';
import { createPgliteDb, createPostgresDb, type Db } from '../db/db.js';
import { migrate } from '../db/migrate.js';
import { MIGRATIONS_DIR } from '../db/index.js';
import { DeezerProvider } from '../providers/music/DeezerProvider.js';
import { MockMedia } from '../providers/music/mock-media.js';
import { MockProvider } from '../providers/music/MockProvider.js';
import { CompositeProvider } from '../providers/music/registry.js';
import { MockRecognition } from '../providers/recognition/MockRecognition.js';
import type { AudioInput, AudioMeta, TelegramSender } from '../services/telegram.js';
import { TelegramSendError } from '../services/telegram.js';

export const TEST_TOKEN = '777:test-bot-token';
export const MEDIA_DIR = path.join(os.tmpdir(), 'auris-test-media');

/** TEST_DATABASE_URL=postgres://… runs the suite against a real PostgreSQL: one fresh database per app. */
async function freshPostgres(adminUrl: string): Promise<Db> {
  const admin = await createPostgresDb(adminUrl);
  const name = `auris_t_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  await admin.exec(`CREATE DATABASE ${name}`);
  await admin.close();
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  return createPostgresDb(u.toString());
}

export class FakeSender implements TelegramSender {
  calls: { chatId: number; input: AudioInput; meta: AudioMeta; size?: number }[] = [];
  notStarted = new Set<number>();
  async sendAudio(chatId: number, input: AudioInput, meta: AudioMeta) {
    if (this.notStarted.has(chatId)) throw new TelegramSendError('not_started', 'Forbidden: bot can\'t initiate conversation with a user');
    const size = 'path' in input ? fs.statSync(input.path).size : undefined;
    this.calls.push({ chatId, input, meta, size });
    return { fileId: `FILE_${this.calls.length}` };
  }
}

/** Deezer adapter with a canned upstream — no network in tests. */
export function fakeDeezer() {
  const track = {
    id: 3135556, title: 'Harder, Better, Faster, Stronger', duration: 226, rank: 810329, readable: true, isrc: 'GBDUW0000059',
    preview: 'https://cdnt-preview.dzcdn.net/x.mp3', artist: { id: 27, name: 'Daft Punk' }, album: { id: 302127, title: 'Discovery', genre_id: 113, cover_big: 'https://e-cdns-images.dzcdn.net/c.jpg' },
  };
  const fetcher = (async (url: string) => {
    if (url.includes('/track/')) return track;
    if (url.includes('/search')) return { data: [track] };
    if (url.includes('/chart/0/tracks')) return { data: [track] };
    if (url.includes('/chart/0/artists')) return { data: [track.artist] };
    if (url.includes('/editorial')) return { data: [] };
    return { data: [] };
  }) as never;
  return new DeezerProvider(fetcher);
}

export async function makeApp(opts: { db?: Db; env?: Partial<Record<string, string>>; sender?: FakeSender } = {}) {
  const env: Env = parseEnv({
    NODE_ENV: 'test',
    BOT_TOKEN: TEST_TOKEN,
    BOT_USERNAME: 'auris_test_bot',
    INTERNAL_API_SECRET: 'internal-secret',
    MINI_APP_URL: 'https://app.auris.test',
    ALLOW_DEV_AUTH: 'false',
    ...opts.env,
  });
  const db = opts.db ?? (process.env.TEST_DATABASE_URL ? await freshPostgres(process.env.TEST_DATABASE_URL) : await createPgliteDb());
  await migrate(db, MIGRATIONS_DIR);
  const mock = new MockProvider(new MockMedia(MEDIA_DIR, 'ffmpeg'));
  const music = new CompositeProvider([mock, fakeDeezer()]);
  const sender = opts.sender ?? new FakeSender();
  const { app, services } = await buildApp({ env, db, music, recognition: new MockRecognition(), sender, hasFfmpeg: true });
  await app.ready();
  return { app, services, db, sender, env };
}

export function auth(userId = 501, first = 'Тест') {
  return { authorization: `tma ${signInitData({ id: userId, first_name: first }, TEST_TOKEN)}` };
}

export function multipartBody(field: string, filename: string, mime: string, data: Buffer) {
  const boundary = '----auris' + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
