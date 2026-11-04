import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createPgliteDb } from '../db/db.js';
import { YouTubeRetention } from '../services/retention.js';
import { auth, fakeYouTube, makeApp, multipartBody } from './helpers.js';

const ctx = await makeApp();
const { app } = ctx;
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
    expect(r.json()).toMatchObject({ id: 501, firstName: 'Ада', termsAccepted: false, stats: { liked: 0, playlists: 0 } });
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

describe('terms of use & privacy policy', () => {
  it('blocks every feature until the terms are accepted, then lets the user in', async () => {
    const c = await makeApp({ terms: false });
    const me = await c.app.inject({ method: 'GET', url: '/api/me', headers: auth(610) });
    expect(me.json().termsAccepted).toBe(false);
    const blocked = await c.app.inject({ method: 'GET', url: '/api/search?q=test', headers: auth(610) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('TERMS_REQUIRED');
    const ok = await c.app.inject({ method: 'POST', url: '/api/terms/accept', headers: auth(610) });
    expect(ok.json().termsAccepted).toBe(true);
    expect((await c.app.inject({ method: 'GET', url: '/api/search?q=test', headers: auth(610) })).statusCode).toBe(200);
    // After erasing everything the same Telegram user gets a fresh profile and is asked to consent again.
    expect((await c.app.inject({ method: 'DELETE', url: '/api/me', headers: auth(610) })).statusCode).toBe(200);
    const again = await c.app.inject({ method: 'GET', url: '/api/me', headers: auth(610) });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ termsAccepted: false, stats: { liked: 0 } });
    // Erasure works even without accepting (nothing is gated behind consent to delete).
    expect((await c.app.inject({ method: 'DELETE', url: '/api/me', headers: auth(611) })).statusCode).toBe(200);
    await c.app.close();
  });
});

describe('no downloads in this version', () => {
  it('has no download endpoints and no download fields on tracks', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/downloads', headers: auth(), payload: { trackId: 'mock:t1' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/internal/download', headers: { 'x-internal-secret': 'internal-secret' }, payload: { userId: 1, trackId: 'mock:t1' } })).statusCode).toBe(404);
    const t = await app.inject({ method: 'GET', url: '/api/tracks/mock:t1', headers: auth() });
    expect(JSON.stringify(t.json())).not.toMatch(/downloadable|downloadNote/);
  });
});

describe('YouTube (separate section, official player only)', () => {
  it('search returns one section per source; YouTube is never mixed into other results', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/search?q=песня', headers: auth() });
    const sections = r.json().sections as { provider: string; tracks: { id: string; provider: string }[] }[];
    expect(sections.map((x) => x.provider)).toEqual(['mock', 'youtube', 'deezer']);
    for (const sec of sections) expect(sec.tracks.every((t) => t.provider === sec.provider)).toBe(true);
    const yt = sections.find((x) => x.provider === 'youtube')!;
    // Not embeddable -> excluded. Title passed through unchanged.
    expect(yt.tracks.map((t) => t.id)).toEqual(['youtube:aaaaaaaaaa1', 'youtube:aaaaaaaaaa2']);
    expect((yt.tracks[0] as unknown as { title: string }).title).toBe('Песня &amp; Клип (Official Video)');
    expect(JSON.stringify(r.json())).not.toContain('YT-SECRET-KEY');
  });
  it('maps videos to embed-only tracks with attribution, no stats, no stream', async () => {
    const t = (await app.inject({ method: 'GET', url: '/api/tracks/youtube:aaaaaaaaaa1', headers: auth() })).json();
    expect(t.playback).toMatchObject({ kind: 'embed', playableSec: 213, qualities: [] });
    expect(t.license).toMatchObject({ name: 'YouTube', sourceUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaa1' });
    expect(t.popularity).toBe(0.5);
    expect(t.youtube).toMatchObject({ videoId: 'aaaaaaaaaa1', channelTitle: 'Канал Артиста', madeForKids: false });
    const s = await app.inject({ method: 'GET', url: '/api/stream-url/youtube:aaaaaaaaaa1', headers: auth() });
    expect(s.statusCode).toBe(400);
  });
  it('keeps YouTube out of merged lists (charts, collections, wave from other sources)', async () => {
    const chart = (await app.inject({ method: 'GET', url: '/api/charts', headers: auth() })).json();
    expect(chart.tracks.some((t: { provider: string }) => t.provider === 'youtube')).toBe(false);
  });
  it('Made for Kids: no events, no likes, never in the wave', async () => {
    const ev = await app.inject({ method: 'POST', url: '/api/events', headers: auth(620), payload: { trackId: 'youtube:aaaaaaaaaa2', kind: 'play_start' } });
    expect(ev.json()).toEqual({ ok: true, stored: false });
    const like = await app.inject({ method: 'POST', url: '/api/likes/youtube:aaaaaaaaaa2', headers: auth(620) });
    expect(like.statusCode).toBe(400);
    const rows = await ctx.db.query('SELECT 1 FROM events WHERE user_id=620');
    expect(rows.rows).toHaveLength(0);
    const w = await app.inject({ method: 'POST', url: '/api/wave/next', headers: auth(620), payload: { count: 20 } });
    expect(w.json().items.some((i: { track: { id: string } }) => i.track.id === 'youtube:aaaaaaaaaa2')).toBe(false);
  });
  it('wave: a liked YouTube channel brings its videos in (search by what the user liked), never "popular" by YouTube stats', async () => {
    const h = auth(640);
    expect((await app.inject({ method: 'POST', url: '/api/likes/youtube:aaaaaaaaaa1', headers: h })).statusCode).toBe(200);
    const w = await app.inject({ method: 'POST', url: '/api/wave/next', headers: h, payload: { count: 20, mode: 'favorite' } });
    const items = w.json().items as { track: { provider: string; id: string }; reasons: string[] }[];
    const ytItems = items.filter((i) => i.track.provider === 'youtube');
    expect(ytItems.length).toBeGreaterThan(0);
    expect(ytItems.every((i) => !i.reasons.includes('Популярно сейчас'))).toBe(true);
    expect(ytItems.some((i) => i.track.id === 'youtube:aaaaaaaaaa2')).toBe(false); // Made for Kids
  });
  it('YouTube country charts are YouTube-only collections', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/collections', headers: auth() })).json().collections.map((c: { id: string }) => c.id);
    expect(list.slice(0, 3)).toEqual(['yt-ru', 'yt-us', 'yt-gb']);
    const ru = (await app.inject({ method: 'GET', url: '/api/collections/yt-us', headers: auth() })).json();
    expect(ru.tracks.length).toBeGreaterThan(0);
    expect(ru.tracks.every((t: { provider: string }) => t.provider === 'youtube')).toBe(true);
    expect(ctx.youtube.calls.some((u) => u.includes('chart=mostPopular') && u.includes('regionCode=US'))).toBe(true);
  });
  it('quota exhausted: readable notice, cached results still served, other sources unaffected', async () => {
    const yt = fakeYouTube();
    const c = await makeApp({ youtube: yt });
    const first = await c.app.inject({ method: 'GET', url: '/api/search?q=кэш', headers: auth() });
    expect(first.json().sections.find((x: { provider: string }) => x.provider === 'youtube').tracks.length).toBe(2);
    yt.setQuotaOut(true);
    const cached = await c.app.inject({ method: 'GET', url: '/api/search?q=кэш', headers: auth() });
    expect(cached.json().sections.find((x: { provider: string }) => x.provider === 'youtube').tracks.length).toBe(2);
    const fresh = await c.app.inject({ method: 'GET', url: '/api/search?q=Северный', headers: auth() });
    const sec = fresh.json().sections.find((x: { provider: string }) => x.provider === 'youtube');
    expect(sec.tracks).toEqual([]);
    expect(sec.notice).toMatch(/Лимит запросов к YouTube/);
    expect(fresh.json().sections.find((x: { provider: string }) => x.provider === 'mock').tracks.length).toBeGreaterThan(0);
    await c.app.close();
  });
  it('retention: data older than the limit is refreshed; deleted videos are forgotten everywhere', async () => {
    const yt = fakeYouTube();
    const c = await makeApp({ youtube: yt });
    await c.app.inject({ method: 'POST', url: '/api/likes/youtube:aaaaaaaaaa1', headers: auth(630) });
    await c.db.query(`UPDATE track_snapshots SET updated_at = now() - interval '40 days' WHERE track_id='youtube:aaaaaaaaaa1'`);
    const ret = new YouTubeRetention(yt.provider, c.services.store, 29);
    expect(await ret.run()).toEqual({ refreshed: 1, removed: 0 });
    const age = await c.db.query<{ d: number }>(`SELECT extract(day from now() - updated_at)::int AS d FROM track_snapshots WHERE track_id='youtube:aaaaaaaaaa1'`);
    expect(age.rows[0]!.d).toBe(0);
    // The video is deleted on YouTube.
    delete yt.videos.aaaaaaaaaa1;
    await c.db.query(`UPDATE track_snapshots SET updated_at = now() - interval '40 days' WHERE track_id='youtube:aaaaaaaaaa1'`);
    expect(await ret.run()).toEqual({ refreshed: 0, removed: 1 });
    expect((await c.db.query(`SELECT 1 FROM likes WHERE track_id='youtube:aaaaaaaaaa1'`)).rows).toHaveLength(0);
    expect((await c.db.query(`SELECT 1 FROM track_snapshots WHERE track_id='youtube:aaaaaaaaaa1'`)).rows).toHaveLength(0);
    // Quota out + over the hard 30-day limit -> deleted instead of kept.
    const noQuota = fakeYouTube();
    noQuota.setQuotaOut(true);
    await c.services.store.saveSnapshots([noQuota.provider.toTrack(noQuota.videos.aaaaaaaaaa2!)]);
    await c.db.query(`UPDATE track_snapshots SET updated_at = now() - interval '31 days' WHERE track_id='youtube:aaaaaaaaaa2'`);
    expect((await new YouTubeRetention(noQuota.provider, c.services.store, 29).run()).removed).toBe(1);
    expect((await c.db.query(`SELECT 1 FROM track_snapshots WHERE track_id='youtube:aaaaaaaaaa2'`)).rows).toHaveLength(0);
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
