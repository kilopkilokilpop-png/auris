import { describe, expect, it } from 'vitest';
import { classifyQuality, pickVariant, playerQualityLine, trackBadge } from './quality.js';
import type { AudioQuality, Track } from './models.js';
import { formatDuration, plural, dayPart } from './format.js';

const base: Track = {
  id: 'mock:1', provider: 'mock', title: 'T', artist: { id: 'mock:a', name: 'A' }, durationSec: 200,
  genres: [], tags: [], popularity: 0.5, license: { name: 'CC0' }, downloadable: false,
  playback: { kind: 'full', playableSec: 200, qualities: [] },
};
const mp3: AudioQuality = { tier: 'standard', codec: 'mp3', bitrateKbps: 320, lossless: false };
const flac16: AudioQuality = { tier: 'hifi', codec: 'flac', bitDepth: 16, sampleRateHz: 44100, lossless: true };
const flac24: AudioQuality = { tier: 'hires', codec: 'flac', bitDepth: 24, sampleRateHz: 96000, lossless: true };

describe('quality', () => {
  it('classifies only from declared data', () => {
    expect(classifyQuality({ codec: 'mp3', bitrateKbps: 320, lossless: false })).toBe('standard');
    expect(classifyQuality({ codec: 'flac', lossless: true })).toBe('hifi');
    expect(classifyQuality({ codec: 'flac', lossless: true, bitDepth: 24, sampleRateHz: 96000 })).toBe('hires');
    expect(classifyQuality({ codec: 'mp3', lossless: false, bitDepth: 24, sampleRateHz: 96000 })).toBe('standard');
  });
  it('never picks above the requested tier when a lower one exists', () => {
    expect(pickVariant([mp3, flac16, flac24], 'hifi')).toBe(flac16);
    expect(pickVariant([mp3, flac16, flac24], 'hires')).toBe(flac24);
    expect(pickVariant([mp3], 'hires')).toBe(mp3);
  });
  it('preview tracks never show quality badges', () => {
    const t = { ...base, playback: { kind: 'preview' as const, playableSec: 30, qualities: [mp3] } };
    expect(trackBadge(t).kind).toBe('preview');
    expect(playerQualityLine(t, 'hires')).toBe('ПРЕВЬЮ · 30 С');
  });
  it('hi-res badge requires real 24-bit data', () => {
    expect(trackBadge({ ...base, playback: { ...base.playback, qualities: [mp3, flac24] } }).label).toBe('HI-RES');
    expect(playerQualityLine({ ...base, playback: { ...base.playback, qualities: [flac24] } }, 'hires')).toBe('HI-RES · 24/96');
    expect(trackBadge({ ...base, playback: { ...base.playback, qualities: [mp3, flac16] } }).label).toBe('FLAC');
    expect(trackBadge({ ...base, playback: { ...base.playback, qualities: [mp3] } }).label).toBe('');
  });
});

describe('format', () => {
  it('formats', () => {
    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration(331)).toBe('5:31');
    expect(plural(1, ['трек', 'трека', 'треков'])).toBe('трек');
    expect(plural(3, ['трек', 'трека', 'треков'])).toBe('трека');
    expect(plural(11, ['трек', 'трека', 'треков'])).toBe('треков');
    expect(dayPart(19)).toBe('evening');
    expect(dayPart(3)).toBe('night');
  });
});
