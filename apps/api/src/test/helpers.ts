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
import { YouTubeProvider, type YtFetch, type YtVideo } from '../providers/music/YouTubeProvider.js';

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

/** Canned YouTube Data API: real-looking ids, no network. `calls` records every request URL. */
export function fakeYouTube(over: Partial<Record<string, Partial<YtVideo>>> = {}) {
  const v = (id: string, title: string, extra: Partial<YtVideo> = {}): YtVideo => ({
    id,
    snippet: { title, channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', channelTitle: 'Канал Артиста', thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } }, liveBroadcastContent: 'none' },
    contentDetails: { duration: 'PT3M33S' },
    status: { uploadStatus: 'processed', privacyStatus: 'public', embeddable: true, madeForKids: false },
    ...extra,
    ...over[id],
  });
  const videos: Record<string, YtVideo> = {
    aaaaaaaaaa1: v('aaaaaaaaaa1', 'Песня &amp; Клип (Official Video)'),
    aaaaaaaaaa2: v('aaaaaaaaaa2', 'Колыбельная', { status: { uploadStatus: 'processed', privacyStatus: 'public', embeddable: true, madeForKids: true } }),
    aaaaaaaaaa3: v('aaaaaaaaaa3', 'Не встраивается', { status: { uploadStatus: 'processed', privacyStatus: 'public', embeddable: false, madeForKids: false } }),
  };
  const calls: string[] = [];
  let quotaOut = false;
  const fetcher: YtFetch = async (url) => {
    calls.push(url);
    if (quotaOut) return { status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } };
    const u = new URL(url);
    if (u.pathname.endsWith('/search')) return { status: 200, body: { items: Object.keys(videos).map((id) => ({ id: { kind: 'youtube#video', videoId: id } })) } };
    if (u.pathname.endsWith('/videos')) {
      if (u.searchParams.get('chart')) return { status: 200, body: { items: [videos.aaaaaaaaaa1] } };
      const ids = (u.searchParams.get('id') ?? '').split(',');
      return { status: 200, body: { items: ids.map((id) => videos[id]).filter(Boolean) } };
    }
    if (u.pathname.endsWith('/channels')) return { status: 200, body: { items: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', snippet: { title: 'Канал Артиста' } }] } };
    return { status: 404, body: {} };
  };
  const provider = new YouTubeProvider('YT-SECRET-KEY', 'RU', 29, fetcher);
  return { provider, calls, videos, setQuotaOut: (v: boolean) => (quotaOut = v) };
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

export async function makeApp(opts: { db?: Db; env?: Partial<Record<string, string>>; terms?: boolean; youtube?: ReturnType<typeof fakeYouTube> } = {}) {
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
  const youtube = opts.youtube ?? fakeYouTube();
  const music = new CompositeProvider([mock, youtube.provider, fakeDeezer()]);
  const { app, services } = await buildApp({ env, db, music, recognition: new MockRecognition(), hasFfmpeg: true });
  // Most suites test features, not consent: pre-accept unless the suite asks otherwise.
  if (opts.terms !== false) services.store.termsAccepted = async () => true;
  await app.ready();
  return { app, services, db, env, youtube };
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
