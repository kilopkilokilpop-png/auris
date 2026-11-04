import { describe, expect, it } from 'vitest';
import { JamendoProvider, jamendoLicenseRule, licenseFromCcUrl, type JmTrack } from './JamendoProvider.js';
import { LicensedProvider } from './LicensedProvider.js';
import { fakeDeezer } from '../../test/helpers.js';

const jm = (over: Partial<JmTrack>): JmTrack => ({
  id: '1', name: 'Song', duration: 200, artist_id: '9', artist_name: 'Artist', audio: 'https://mp3l.jamendo.com/?trackid=1&format=mp32&client_id=SECRET',
  license_ccurl: 'http://creativecommons.org/licenses/by-nc-sa/3.0/', shareurl: 'https://www.jamendo.com/track/1', ...over,
});
const jamendoWith = (t: JmTrack) =>
  new JamendoProvider('SECRET', (async () => ({ headers: { status: 'success', code: 0 }, results: [t] })) as never);

describe('Jamendo licence rules', () => {
  it('parses CC licences', () => {
    expect(licenseFromCcUrl('http://creativecommons.org/licenses/by-nc-nd/3.0/').name).toBe('CC BY-NC-ND 3.0');
    expect(licenseFromCcUrl('https://creativecommons.org/publicdomain/zero/1.0/').name).toBe('CC0 1.0');
    expect(licenseFromCcUrl(undefined).isCreativeCommons).toBe(false);
  });
  it('disables tracks without a recognised CC licence', async () => {
    expect(jamendoLicenseRule(jm({})).ok).toBe(true);
    expect(jamendoLicenseRule(jm({ license_ccurl: 'https://example.com/eula' })).ok).toBe(false);
    expect(jamendoLicenseRule(jm({ license_ccurl: undefined })).ok).toBe(false);
    const off = (await jamendoWith(jm({ license_ccurl: undefined })).getTrack('jamendo:1'))!;
    expect(off.playback.kind).toBe('none');
  });
  it('shows author, licence link and a Jamendo backlink on every track; no downloads', async () => {
    const t = (await jamendoWith(jm({})).getTrack('jamendo:1'))!;
    expect(t.license).toMatchObject({ name: 'CC BY-NC-SA 3.0', url: 'http://creativecommons.org/licenses/by-nc-sa/3.0/', sourceUrl: 'https://www.jamendo.com/track/1' });
    expect(t.license.attribution).toContain('Artist');
    expect(JSON.stringify(t)).not.toMatch(/download/i);
  });
  it('maps tracks as full-length, never claiming lossless', async () => {
    const t = (await jamendoWith(jm({})).getTrack('jamendo:1'))!;
    expect(t.playback.kind).toBe('full');
    expect(t.playback.qualities.every((q) => !q.lossless)).toBe(true);
    expect(JSON.stringify(t)).not.toContain('SECRET');
  });
});

describe('Jamendo flaky empty answers', () => {
  it('retries an empty result and does not cache it', async () => {
    let calls = 0;
    const p = new JamendoProvider('id', (async () => {
      calls++;
      return { headers: { status: 'success', code: 0 }, results: calls === 1 ? [] : [jm({})] };
    }) as never, 3);
    expect((await p.getChart(5)).length).toBe(1);
    expect(calls).toBe(2);
    await p.getChart(5);
    expect(calls).toBe(2); // non-empty answer cached
  });
});

describe('Jamendo popularity', () => {
  it('maps raw counters to 0..1 on a log scale', async () => {
    const { jamendoPopularity } = await import('./JamendoProvider.js');
    expect(jamendoPopularity(undefined)).toBe(0);
    expect(jamendoPopularity({ rate_listened_total: 0 })).toBe(0);
    const small = jamendoPopularity({ rate_listened_total: 100 });
    const big = jamendoPopularity({ rate_listened_total: 1738, rate_downloads_total: 9_913_849 });
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(1);
  });
});

describe('Deezer', () => {
  it('is preview-only', async () => {
    const dz = fakeDeezer();
    const t = (await dz.getTrack('deezer:3135556'))!;
    expect(t.playback).toMatchObject({ kind: 'preview', playableSec: 30 });
    expect(t.genres).toEqual(['dance']);
  });
});

describe('Licensed (B2B stub)', () => {
  const track = { id: 'x1', title: 'T', artist: { id: 'a', name: 'A' }, durationSec: 180, variants: [{ codec: 'flac' as const, bitDepth: 24, sampleRateHz: 96000, lossless: true }], rights: { stream: true, preview: true } };
  const fetcher = (async (url: string) => (url.includes('/stream') ? { url: 'https://cdn/x.flac', mime: 'audio/flac' } : track)) as never;
  it('classifies Hi-Res only from declared 24-bit data', async () => {
    const p = new LicensedProvider({ url: 'https://lx', key: 'k' }, fetcher);
    expect((await p.getTrack('licensed:x1')).playback.qualities[0]!.tier).toBe('hires');
  });
  it('is inert when not configured', async () => {
    const p = new LicensedProvider({});
    await expect(p.getChart(5)).rejects.toThrow(/not configured/);
  });
});

describe('Audius', () => {
  const au = (over: Record<string, unknown>) => ({
    id: 'a1', title: 'Song', duration: 200, genre: 'Electronic', mood: 'Peaceful', play_count: 5000, permalink: '/artist/song',
    artwork: { '480x480': 'https://img/480.jpg' }, user: { id: 'u1', name: 'Artist' }, is_streamable: true, is_stream_gated: false, ...over,
  });
  const make = async (tracks: unknown[]) => {
    const { AudiusProvider } = await import('./AudiusProvider.js');
    return new AudiusProvider('AURIS', 'https://api.test/v1', (async (url: string) => ({ data: url.includes('/tracks/a1') ? tracks[0] : tracks })) as never);
  };
  it('offers only streamable, non-gated tracks as full-length', async () => {
    const p = await make([au({}), au({ id: 'a2', is_stream_gated: true }), au({ id: 'a3', is_streamable: false })]);
    const chart = await p.getChart(10);
    expect(chart.map((t) => t.id)).toEqual(['audius:a1']);
    expect(chart[0]!.playback).toMatchObject({ kind: 'full', playableSec: 200 });
    expect(chart[0]!.tags).toContain('calm');
    expect(chart[0]!.license.sourceUrl).toBe('https://audius.co/artist/song');
  });
  it('streams via the API with app_name', async () => {
    const p = await make([au({})]);
    const s = await p.getStream('audius:a1', 'standard');
    expect(s?.url).toBe('https://api.test/v1/tracks/a1/stream?app_name=AURIS');
    const gated = await make([au({ is_stream_gated: true })]);
    expect(await gated.getStream('audius:a1', 'standard')).toBeNull();
  });
});

describe('Audius Russian filter', () => {
  it('drops compilations and hours-long mixes', async () => {
    const { isCompilation } = await import('./AudiusProvider.js');
    expect(isCompilation('НОВИНКИ МУЗЫКИ 2023 - 2024 #9', 300)).toBe(true);
    expect(isCompilation('Сожаления', 200)).toBe(false);
    expect(isCompilation('Late night set', 3600)).toBe(true);
  });
});
