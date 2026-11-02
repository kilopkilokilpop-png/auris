import { describe, expect, it } from 'vitest';
import { JamendoProvider, jamendoDownloadRule, licenseFromCcUrl, type JmTrack } from './JamendoProvider.js';
import { LicensedProvider } from './LicensedProvider.js';
import { fakeDeezer } from '../../test/helpers.js';

const jm = (over: Partial<JmTrack>): JmTrack => ({
  id: '1', name: 'Song', duration: 200, artist_id: '9', artist_name: 'Artist', audio: 'https://mp3l.jamendo.com/?trackid=1&format=mp32&client_id=SECRET',
  audiodownload: 'https://mp3d.jamendo.com/download/track/1/mp32/', audiodownload_allowed: true,
  license_ccurl: 'http://creativecommons.org/licenses/by-nc-sa/3.0/', shareurl: 'https://www.jamendo.com/track/1', ...over,
});
const jamendoWith = (t: JmTrack) =>
  new JamendoProvider('SECRET', false, (async () => ({ headers: { status: 'success', code: 0 }, results: [t] })) as never);

describe('Jamendo licence rules', () => {
  it('parses CC licences', () => {
    expect(licenseFromCcUrl('http://creativecommons.org/licenses/by-nc-nd/3.0/').name).toBe('CC BY-NC-ND 3.0');
    expect(licenseFromCcUrl('https://creativecommons.org/publicdomain/zero/1.0/').name).toBe('CC0 1.0');
    expect(licenseFromCcUrl(undefined).isCreativeCommons).toBe(false);
  });
  it('allows only with artist permission + CC licence + URL', () => {
    expect(jamendoDownloadRule(jm({})).ok).toBe(true);
    expect(jamendoDownloadRule(jm({ audiodownload_allowed: false }))).toMatchObject({ ok: false, code: 'license_forbids' });
    expect(jamendoDownloadRule(jm({ audiodownload_allowed: undefined }))).toMatchObject({ ok: false, code: 'rights_unknown' });
    expect(jamendoDownloadRule(jm({ audiodownload: '' }))).toMatchObject({ ok: false });
    expect(jamendoDownloadRule(jm({ license_ccurl: 'https://example.com/eula' }))).toMatchObject({ ok: false, code: 'rights_unknown' });
  });
  it('getDownload re-checks per track and includes attribution', async () => {
    const ok = await jamendoWith(jm({})).getDownload('jamendo:1');
    expect(ok.allowed).toBe(true);
    if (ok.allowed) {
      expect(ok.attribution).toContain('CC BY-NC-SA 3.0');
      expect(ok.attribution).toContain('jamendo.com/track/1');
      expect(ok.cacheFileId).toBe(false);
    }
    const no = await jamendoWith(jm({ audiodownload_allowed: false, audiodownload: '' })).getDownload('jamendo:1');
    expect(no.allowed).toBe(false);
  });
  it('maps tracks as full-length, never claiming lossless', async () => {
    const t = (await jamendoWith(jm({})).getTrack('jamendo:1'))!;
    expect(t.playback.kind).toBe('full');
    expect(t.playback.qualities.every((q) => !q.lossless)).toBe(true);
    expect(JSON.stringify(t)).not.toContain('SECRET');
  });
});

describe('Deezer', () => {
  it('is preview-only and never downloadable', async () => {
    const dz = fakeDeezer();
    const t = (await dz.getTrack('deezer:3135556'))!;
    expect(t.playback).toMatchObject({ kind: 'preview', playableSec: 30 });
    expect(t.downloadable).toBe(false);
    expect((await dz.getDownload('deezer:3135556')).allowed).toBe(false);
    expect(t.genres).toEqual(['dance']);
  });
});

describe('Licensed (B2B stub)', () => {
  const track = { id: 'x1', title: 'T', artist: { id: 'a', name: 'A' }, durationSec: 180, variants: [{ codec: 'flac' as const, bitDepth: 24, sampleRateHz: 96000, lossless: true }], rights: { stream: true, preview: true, download: true } };
  const fetcher = (async (url: string) => (url.endsWith('/download') ? { url: 'https://cdn/x.mp3', mime: 'audio/mpeg' } : track)) as never;
  it('denies downloads until the contract flag is set', async () => {
    const p = new LicensedProvider({ url: 'https://lx', key: 'k', downloadsContracted: false, cacheFileId: false }, fetcher);
    expect(await p.getDownload('licensed:x1')).toMatchObject({ allowed: false, code: 'not_contracted' });
    const p2 = new LicensedProvider({ url: 'https://lx', key: 'k', downloadsContracted: true, cacheFileId: false }, fetcher);
    expect((await p2.getDownload('licensed:x1')).allowed).toBe(true);
  });
  it('classifies Hi-Res only from declared 24-bit data', async () => {
    const p = new LicensedProvider({ url: 'https://lx', key: 'k', downloadsContracted: false, cacheFileId: false }, fetcher);
    expect((await p.getTrack('licensed:x1')).playback.qualities[0]!.tier).toBe('hires');
  });
  it('is inert when not configured', async () => {
    const p = new LicensedProvider({ downloadsContracted: false, cacheFileId: false });
    await expect(p.getChart(5)).rejects.toThrow(/not configured/);
  });
});
