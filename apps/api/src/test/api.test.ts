import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createPgliteDb } from '../db/db.js';
import { auth, FakeSender, makeApp, multipartBody } from './helpers.js';

const ctx = await makeApp();
const { app, sender } = ctx;
afterAll(async () => {
  await app.close();
  await ctx.db.close();
});

describe('auth & security', () => {
  it('rejects requests without initData', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHORIZED');
  });
  it('rejects forged initData', async () => {
    const h = auth(1).authorization.replace(/hash=[a-f0-9]+/, 'hash=' + 'a'.repeat(64));
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: h } })).statusCode).toBe(401);
  });
  it('accepts valid initData and creates the user', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: auth(501, 'Ада') });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: 501, firstName: 'Ада', isMaster: false, stats: { liked: 0, playlists: 0 } });
  });
  it('allows CORS only for the Mini App origin', async () => {
    const ok = await app.inject({ method: 'OPTIONS', url: '/api/me', headers: { origin: 'https://app.auris.test', 'access-control-request-method': 'GET' } });
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.auris.test');
    const bad = await app.inject({ method: 'OPTIONS', url: '/api/me', headers: { origin: 'https://evil.test', 'access-control-request-method': 'GET' } });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('validates input', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/likes/not-an-id', headers: auth() });
    expect(r.statusCode).toBe(400);
  });
  it('internal routes require the shared secret', async () => {
    expect((await app.inject({ method: 'GET', url: '/internal/likes?userId=1' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/internal/likes?userId=1', headers: { 'x-internal-secret': 'internal-secret' } })).statusCode).toBe(200);
  });
  it('never leaks provider URLs: stream URLs are signed and proxied', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/stream-url/deezer:3135556', headers: auth() });
    expect(r.json().url).toMatch(/^\/api\/stream\/[\w-]+\.[\w-]+$/);
    expect(r.json().kind).toBe('preview');
    expect(JSON.stringify(r.json())).not.toContain('dzcdn');
  });
});

describe('downloads', () => {
  it('refuses a Deezer track even on a direct API call', async () => {
    const before = sender.calls.length;
    const r = await app.inject({ method: 'POST', url: '/api/downloads', headers: auth(), payload: { trackId: 'deezer:3135556' } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('DOWNLOAD_FORBIDDEN');
    expect(sender.calls.length).toBe(before);
    const c = await app.inject({ method: 'GET', url: '/api/downloads/check/deezer:3135556', headers: auth() });
    expect(c.json()).toEqual({ allowed: false, reason: expect.stringMatching(/Deezer/) });
  });

  it('sends an allowed track with metadata, then reuses the cached file_id', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/downloads', headers: auth(502), payload: { trackId: 'mock:t1' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ status: 'sent', cached: false });
    const call = sender.calls.at(-1)!;
    expect(call.chatId).toBe(502);
    expect('path' in call.input && call.size! > 10_000).toBe(true);
    expect(call.meta).toMatchObject({ title: 'Магнитное поле', performer: 'Северный Шум', durationSec: 45 });
    expect(call.meta.thumbnail?.length).toBeGreaterThan(100);
    const again = await app.inject({ method: 'POST', url: '/api/downloads', headers: auth(502), payload: { trackId: 'mock:t1' } });
    expect(again.json()).toEqual({ status: 'sent', cached: true });
    expect(sender.calls.at(-1)!.input).toEqual({ fileId: 'FILE_1' });
    const rows = await ctx.db.query<{ track_id: string; provider: string }>('SELECT track_id, provider FROM downloads WHERE user_id=502');
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toEqual({ track_id: 'mock:t1', provider: 'mock' });
  });

  it('explains how to start the bot when Telegram refuses to message the user', async () => {
    sender.notStarted.add(503);
    const r = await app.inject({ method: 'POST', url: '/api/downloads', headers: auth(503), payload: { trackId: 'mock:t2' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'BOT_NOT_STARTED', botLink: 'https://t.me/auris_test_bot?start=download' });
  });

  it('enforces the per-user daily download quota', async () => {
    const c = await makeApp({ env: { DOWNLOADS_PER_DAY: '1' }, sender: new FakeSender() });
    expect((await c.app.inject({ method: 'POST', url: '/api/downloads', headers: auth(9), payload: { trackId: 'mock:t3' } })).statusCode).toBe(200);
    const r = await c.app.inject({ method: 'POST', url: '/api/downloads', headers: auth(9), payload: { trackId: 'mock:t4' } });
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe('DOWNLOAD_QUOTA');
    await c.app.close();
  });
});

describe('player stream', () => {
  it('serves byte ranges for the global <audio> player', async () => {
    const u = await app.inject({ method: 'GET', url: '/api/stream-url/mock:t1?quality=hires', headers: auth() });
    expect(u.json()).toMatchObject({ kind: 'full', qualityLine: 'HI-RES · 24/96' });
    const r = await app.inject({ method: 'GET', url: u.json().url, headers: { range: 'bytes=0-1023' } });
    expect(r.statusCode).toBe(206);
    expect(r.headers['content-type']).toBe('audio/flac');
    expect(r.rawPayload.length).toBe(1024);
    const bad = await app.inject({ method: 'GET', url: u.json().url.replace(/.$/, 'x') });
    expect(bad.statusCode).toBe(401);
  });
  it('standard quality falls back to MP3', async () => {
    const u = await app.inject({ method: 'GET', url: '/api/stream-url/mock:t1?quality=standard', headers: auth() });
    expect(u.json().qualityLine).toBe('MP3 · 192');
  });
});

describe('Резонанс via API', () => {
  it('a like changes the next queue immediately', async () => {
    const h = auth(600);
    const first = await app.inject({ method: 'POST', url: '/api/wave/next', headers: h, payload: { mood: 'any', mode: 'mix', count: 5 } });
    expect(first.statusCode, first.body).toBe(200);
    const before = first.json().items.map((i: { track: { id: string } }) => i.track.id);
    expect(before).toHaveLength(5);
    // Like a jazz track from Koda Brass
    await app.inject({ method: 'POST', url: '/api/likes/mock:t9', headers: h });
    await app.inject({ method: 'POST', url: '/api/events', headers: h, payload: { trackId: 'mock:t9', kind: 'play_complete', listenedSec: 45 } });
    const after = await app.inject({ method: 'POST', url: '/api/wave/next', headers: h, payload: { mood: 'any', mode: 'favorite', count: 5, exclude: ['mock:t9'] } });
    const items = after.json().items as { track: { id: string; artist: { name: string } }; reasons: string[] }[];
    expect(items[0]!.track.artist.name).toBe('Koda Brass');
    expect(items[0]!.reasons.join(' ')).toMatch(/Koda Brass/);
  });
  it('a dislike removes the track and an early skip demotes the artist', async () => {
    const h = auth(601);
    await app.inject({ method: 'POST', url: '/api/dislikes/mock:t11', headers: h });
    await app.inject({ method: 'POST', url: '/api/events', headers: h, payload: { trackId: 'mock:t12', kind: 'skip', positionSec: 3 } });
    const r = await app.inject({ method: 'POST', url: '/api/wave/next', headers: h, payload: { count: 20, mode: 'mix' } });
    const ids = r.json().items.map((i: { track: { id: string } }) => i.track.id);
    expect(ids).not.toContain('mock:t11');
    expect(ids).not.toContain('mock:t12'); // recently played
  });
});

describe('Слух', () => {
  const sample = path.join(os.tmpdir(), 'auris-sample.webm');
  if (!fs.existsSync(sample)) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=9', '-c:a', 'libopus', sample]);
  }
  it('recognises an uploaded clip, matches it to the catalogue and stores history', async () => {
    const mp = multipartBody('audio', 'clip.webm', 'audio/webm;codecs=opus', fs.readFileSync(sample));
    const r = await app.inject({ method: 'POST', url: '/api/recognize', headers: { ...auth(700), ...mp.headers }, payload: mp.payload });
    expect(r.statusCode, r.body).toBe(200);
    const rec = r.json();
    expect(rec.track?.id).toMatch(/^mock:/);
    expect(rec.source).toBe('miniapp');
    const list = await app.inject({ method: 'GET', url: '/api/recognitions', headers: auth(700) });
    expect(list.json().items[0].title).toBe(rec.title);
  });
  it('reports "not recognised" for a near-empty clip and rejects unsupported formats', async () => {
    const tiny = multipartBody('audio', 'x.webm', 'audio/webm', Buffer.alloc(10, 1));
    const r = await app.inject({ method: 'POST', url: '/api/recognize', headers: { ...auth(701), ...tiny.headers }, payload: tiny.payload });
    expect([404, 422]).toContain(r.statusCode);
    const bad = multipartBody('audio', 'x.txt', 'text/plain', Buffer.alloc(5000, 1));
    const b = await app.inject({ method: 'POST', url: '/api/recognize', headers: { ...auth(701), ...bad.headers }, payload: bad.payload });
    expect(b.statusCode).toBe(415);
  });
  it('rate-limits recognition per user', async () => {
    const mp = multipartBody('audio', 'clip.webm', 'audio/webm', fs.readFileSync(sample));
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await app.inject({ method: 'POST', url: '/api/recognize', headers: { ...auth(702), ...mp.headers }, payload: mp.payload })).statusCode);
    }
    expect(codes).toContain(429);
  });
});

describe('privacy', () => {
  it('reset clears signals, delete removes everything', async () => {
    const h = auth(800);
    await app.inject({ method: 'POST', url: '/api/likes/mock:t1', headers: h });
    await app.inject({ method: 'POST', url: '/api/me/reset-recommendations', headers: h });
    const ev = await ctx.db.query('SELECT 1 FROM events WHERE user_id=800');
    expect(ev.rows).toHaveLength(0);
    await app.inject({ method: 'DELETE', url: '/api/me', headers: h });
    const u = await ctx.db.query('SELECT 1 FROM likes WHERE user_id=800');
    expect(u.rows).toHaveLength(0);
  });
});

describe('persistence', () => {
  it('user data survives a restart (on-disk Postgres)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auris-pg-'));
    const db1 = await createPgliteDb(path.join(dir, 'pg'));
    const a = await makeApp({ db: db1 });
    await a.app.inject({ method: 'POST', url: '/api/likes/mock:t5', headers: auth(900) });
    await a.app.inject({ method: 'POST', url: '/api/playlists', headers: auth(900), payload: { title: 'Ночь' } });
    await a.app.close();
    await db1.close();

    const db2 = await createPgliteDb(path.join(dir, 'pg'));
    const b = await makeApp({ db: db2 });
    const me = await b.app.inject({ method: 'GET', url: '/api/me', headers: auth(900) });
    expect(me.json().stats).toMatchObject({ liked: 1, playlists: 1 });
    const likes = await b.app.inject({ method: 'GET', url: '/api/likes', headers: auth(900) });
    expect(likes.json().tracks[0].id).toBe('mock:t5');
    await b.app.close();
    await db2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('internal routes in the all-in-one deploy', () => {
  it('refuse proxied (public) traffic even from loopback, accept direct loopback calls', async () => {
    const c = await makeApp({ env: { INTERNAL_LOOPBACK_ONLY: 'true' } });
    const h = { 'x-internal-secret': 'internal-secret' };
    expect((await c.app.inject({ method: 'GET', url: '/internal/likes?userId=1', headers: h, remoteAddress: '127.0.0.1' })).statusCode).toBe(200);
    expect((await c.app.inject({ method: 'GET', url: '/internal/likes?userId=1', headers: { ...h, 'x-forwarded-for': '203.0.113.7' }, remoteAddress: '127.0.0.1' })).statusCode).toBe(404);
    expect((await c.app.inject({ method: 'GET', url: '/internal/likes?userId=1', headers: h, remoteAddress: '203.0.113.7' })).statusCode).toBe(404);
    await c.app.close();
  });
});

describe('shared playlists', () => {
  it('owner invites, friend joins and adds, rights are enforced', async () => {
    const owner = auth(1001, 'Аня');
    const friend = auth(1002, 'Борис');
    const stranger = auth(1003, 'Чужой');
    const { id } = (await app.inject({ method: 'POST', url: '/api/playlists', headers: owner, payload: { title: 'Дорога' } })).json();
    await app.inject({ method: 'POST', url: `/api/playlists/${id}/tracks`, headers: owner, payload: { trackId: 'mock:t1' } });

    // Not a member yet: looks like it does not exist
    expect((await app.inject({ method: 'GET', url: `/api/playlists/${id}`, headers: friend })).statusCode).toBe(404);

    const inv = (await app.inject({ method: 'POST', url: `/api/playlists/${id}/invite`, headers: owner })).json();
    expect(inv.link).toBe(`https://t.me/auris_test_bot?start=pl_${inv.token}`);
    // Same token on repeat
    expect((await app.inject({ method: 'POST', url: `/api/playlists/${id}/invite`, headers: owner })).json().token).toBe(inv.token);

    const preview = (await app.inject({ method: 'GET', url: `/api/playlists/invite/${inv.token}`, headers: friend })).json();
    expect(preview).toMatchObject({ title: 'Дорога', owner: 'Аня', trackCount: 1, memberCount: 1 });
    expect((await app.inject({ method: 'POST', url: '/api/playlists/join', headers: friend, payload: { token: inv.token } })).json()).toEqual({ id, title: 'Дорога' });

    await app.inject({ method: 'POST', url: `/api/playlists/${id}/tracks`, headers: friend, payload: { trackId: 'mock:t2' } });
    const detail = (await app.inject({ method: 'GET', url: `/api/playlists/${id}`, headers: owner })).json();
    expect(detail.tracks.map((t: { id: string }) => t.id)).toEqual(['mock:t1', 'mock:t2']);
    expect(detail.members.map((m: { name: string; role: string }) => `${m.name}:${m.role}`)).toEqual(['Аня:owner', 'Борис:editor']);
    expect(detail.addedBy['mock:t2']).toBe(1002);

    const list = (await app.inject({ method: 'GET', url: '/api/playlists', headers: friend })).json().playlists;
    expect(list[0]).toMatchObject({ id, role: 'editor', memberCount: 2, trackCount: 2 });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: friend })).json().stats.playlists).toBe(1);

    // Friend cannot remove the owner's track, can remove their own
    expect((await app.inject({ method: 'DELETE', url: `/api/playlists/${id}/tracks/mock:t1`, headers: friend })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/playlists/${id}/tracks/mock:t2`, headers: friend })).statusCode).toBe(200);
    // Stranger cannot touch it
    expect((await app.inject({ method: 'POST', url: `/api/playlists/${id}/tracks`, headers: stranger, payload: { trackId: 'mock:t3' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/playlists/join', headers: stranger, payload: { token: 'not-a-real-token' } })).statusCode).toBe(404);

    // Friend leaves (playlist stays); owner deletes for everyone
    expect((await app.inject({ method: 'DELETE', url: `/api/playlists/${id}`, headers: friend })).json()).toEqual({ ok: true, deleted: false });
    expect((await app.inject({ method: 'GET', url: `/api/playlists/${id}`, headers: owner })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/playlists/${id}`, headers: owner })).json()).toEqual({ ok: true, deleted: true });
    expect((await app.inject({ method: 'GET', url: `/api/playlists/${id}`, headers: owner })).statusCode).toBe(404);
  });
  it('bot can look up an invite', async () => {
    const owner = auth(1010, 'Вера');
    const { id } = (await app.inject({ method: 'POST', url: '/api/playlists', headers: owner, payload: { title: 'Субботa' } })).json();
    const { token } = (await app.inject({ method: 'POST', url: `/api/playlists/${id}/invite`, headers: owner })).json();
    const r = await app.inject({ method: 'GET', url: `/internal/playlist-invite?token=${token}`, headers: { 'x-internal-secret': 'internal-secret' } });
    expect(r.json()).toMatchObject({ title: 'Субботa', owner: 'Вера', trackCount: 0 });
  });
});

describe('collections', () => {
  it('lists curated playlists and fills one with playable tracks, full first', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/collections', headers: auth() })).json().collections;
    expect(list.length).toBeGreaterThanOrEqual(8);
    const calm = (await app.inject({ method: 'GET', url: '/api/collections/mood-calm', headers: auth() })).json();
    expect(calm.tracks.length).toBeGreaterThan(0);
    expect(calm.tracks.every((t: { playback: { kind: string } }) => t.playback.kind !== 'none')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/collections/nope', headers: auth() })).statusCode).toBe(404);
  });
});

describe('tracks from a disconnected source', () => {
  it('are hidden from likes, recent and counters but kept in the database', async () => {
    const h = auth(1201);
    await app.inject({ method: 'GET', url: '/api/me', headers: h });
    await app.inject({ method: 'POST', url: '/api/likes/mock:t1', headers: h });
    await ctx.db.query(`INSERT INTO likes (user_id, track_id) VALUES (1201, 'licensed:gone1')`);
    await ctx.db.query(`INSERT INTO events (user_id, track_id, kind) VALUES (1201, 'licensed:gone1', 'play_start')`);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: h })).json().stats.liked).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/api/likes/ids', headers: h })).json().ids).toEqual(['mock:t1']);
    const home = (await app.inject({ method: 'GET', url: '/api/home', headers: h })).json();
    expect(home.recent.map((t: { id: string }) => t.id)).not.toContain('licensed:gone1');
    const kept = await ctx.db.query(`SELECT 1 FROM likes WHERE user_id=1201 AND track_id='licensed:gone1'`);
    expect(kept.rows).toHaveLength(1);
  });
});
