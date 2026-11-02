import { describe, expect, it } from 'vitest';
import type { Track } from '@auris/shared';
import { buildProfile, decay, moodMatch, scoreTrack, selectQueue, signalValue, type Signal } from './scoring.js';
import { RECO_WEIGHTS } from './weights.js';

const now = new Date('2026-11-02T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

function track(id: string, artist: string, extra: Partial<Track> = {}): Track {
  return {
    id: `mock:${id}`,
    provider: 'mock',
    title: id,
    artist: { id: `mock:${artist}`, name: artist.toUpperCase() },
    durationSec: 200,
    genres: ['electronic'],
    tags: [],
    popularity: 0.5,
    playback: { kind: 'full', playableSec: 200, qualities: [] },
    license: { name: 'CC0' },
    downloadable: false,
    ...extra,
  };
}
const sig = (kind: Signal['kind'], t: Track, at = now, extra: Partial<Signal> = {}): Signal => ({
  kind, trackId: t.id, artistId: t.artist.id, genres: t.genres, tags: t.tags, at, ...extra,
});

const catalogue = [
  track('a1', 'a'), track('a2', 'a'), track('a3', 'a'),
  track('b1', 'b', { genres: ['jazz'] }), track('b2', 'b', { genres: ['jazz'] }),
  track('c1', 'c', { genres: ['rock'] }), track('c2', 'c', { genres: ['rock'] }),
  track('d1', 'd', { genres: ['ambient'], tags: ['calm'] }), track('d2', 'd', { genres: ['ambient'], tags: ['calm'] }),
  track('e1', 'e', { genres: ['hiphop'], tags: ['workout'] }),
];
const byId = (id: string) => catalogue.find((t) => t.id === `mock:${id}`)!;

function rank(signals: Signal[], mode: 'favorite' | 'mix' | 'discovery' = 'mix', mood: 'any' | 'calm' | 'sport' = 'any') {
  const profile = buildProfile(signals, now);
  const scored = catalogue.map((t) => scoreTrack(t, { profile, mode, mood, seed: 's' }));
  return { profile, scored, order: [...scored].sort((x, y) => y.score - x.score).map((s) => s.track.id) };
}
const scoreOf = (r: ReturnType<typeof rank>, id: string) => r.scored.find((s) => s.track.id === `mock:${id}`)!.score;

describe('signal values', () => {
  it('like is strongly positive, dislike strongly negative', () => {
    const t = byId('a1');
    expect(signalValue(sig('like', t))).toBeGreaterThan(signalValue(sig('play_complete', t)));
    expect(signalValue(sig('dislike', t))).toBeLessThan(signalValue(sig('skip', t, now, { positionSec: 5 })));
  });
  it('early skip is negative, late skip is mild', () => {
    const t = byId('a1');
    expect(signalValue(sig('skip', t, now, { positionSec: 8, durationSec: 200 }))).toBe(RECO_WEIGHTS.signals.earlySkip);
    expect(signalValue(sig('skip', t, now, { positionSec: 150, durationSec: 200 }))).toBe(RECO_WEIGHTS.signals.lateSkip);
  });
  it('recent actions weigh more than old ones', () => {
    expect(decay(daysAgo(0), now)).toBeCloseTo(1);
    expect(decay(daysAgo(RECO_WEIGHTS.halfLifeDays), now)).toBeCloseTo(0.5);
    const fresh = buildProfile([sig('like', byId('b1'), daysAgo(0))], now).artist.get('mock:b')!;
    const old = buildProfile([sig('like', byId('b1'), daysAgo(60))], now).artist.get('mock:b')!;
    expect(fresh).toBeGreaterThan(old);
  });
});

describe('scoring', () => {
  it('a like lifts the artist to the top', () => {
    const before = rank([]);
    const after = rank([sig('like', byId('c1'))]);
    expect(scoreOf(after, 'c2')).toBeGreaterThan(scoreOf(before, 'c2'));
    expect(after.order.slice(0, 2)).toContain('mock:c2');
  });
  it('a dislike pushes the artist down and excludes the track', () => {
    const r = rank([sig('dislike', byId('a1'))]);
    expect(r.profile.disliked.has('mock:a1')).toBe(true);
    expect(scoreOf(r, 'a2')).toBeLessThan(scoreOf(rank([]), 'a2'));
    const q = selectQueue(r.scored, r.profile, { count: 10, exclude: new Set(), recentArtists: [] });
    expect(q.map((s) => s.track.id)).not.toContain('mock:a1');
  });
  it('early skips hurt more than completed plays', () => {
    const skipped = rank([sig('skip', byId('b1'), now, { positionSec: 4, durationSec: 200 })]);
    const completed = rank([sig('play_complete', byId('b1'))]);
    expect(scoreOf(skipped, 'b2')).toBeLessThan(scoreOf(completed, 'b2'));
  });
  it('unlike cancels the "liked" state', () => {
    const r = rank([sig('like', byId('a1'), daysAgo(1)), sig('unlike', byId('a1'))]);
    expect(r.profile.liked.has('mock:a1')).toBe(false);
  });
  it('favorite mode prefers known artists, discovery prefers new ones', () => {
    const history = [sig('like', byId('a1')), sig('play_complete', byId('a2')), sig('play_complete', byId('a3'))];
    const fav = rank(history, 'favorite');
    const disc = rank(history, 'discovery');
    expect(scoreOf(fav, 'a2') - scoreOf(fav, 'd1')).toBeGreaterThan(0);
    expect(scoreOf(disc, 'd1') - scoreOf(disc, 'a2')).toBeGreaterThan(0);
    // Liked track itself: favored in "Любимое", avoided in "Открытия".
    expect(scoreOf(fav, 'a1')).toBeGreaterThan(scoreOf(disc, 'a1'));
  });
  it('mood shifts the ranking', () => {
    expect(moodMatch(byId('d1'), 'calm')).toBeGreaterThan(0);
    expect(moodMatch(byId('e1'), 'calm')).toBeLessThan(0);
    const calm = rank([], 'mix', 'calm');
    const sport = rank([], 'mix', 'sport');
    expect(calm.order.indexOf('mock:d1')).toBeLessThan(sport.order.indexOf('mock:d1'));
  });
  it('explains itself', () => {
    const r = rank([sig('like', byId('c1'))]);
    expect(r.scored.find((s) => s.track.id === 'mock:c2')!.reasons[0]).toMatch(/Вам нравится C/);
  });
});

describe('queue selection', () => {
  it('never places the same artist within the window', () => {
    const r = rank([sig('like', byId('a1')), sig('like', byId('a2'))], 'favorite');
    const q = selectQueue(r.scored, r.profile, { count: 6, exclude: new Set(), recentArtists: [] });
    for (let i = 1; i < q.length; i++) {
      const windowArtists = q.slice(Math.max(0, i - (RECO_WEIGHTS.artistWindow - 1)), i).map((s) => s.track.artist.id);
      expect(windowArtists).not.toContain(q[i]!.track.artist.id);
    }
  });
  it('does not repeat excluded (recent / already queued) tracks', () => {
    const r = rank([]);
    const first = selectQueue(r.scored, r.profile, { count: 4, exclude: new Set(), recentArtists: [] });
    const next = selectQueue(r.scored, r.profile, {
      count: 4,
      exclude: new Set(first.map((s) => s.track.id)),
      recentArtists: first.map((s) => s.track.artist.id),
    });
    expect(next.some((s) => first.some((f) => f.track.id === s.track.id))).toBe(false);
    expect(next[0]!.track.artist.id).not.toBe(first[first.length - 1]!.track.artist.id);
  });
  it('the upcoming queue changes immediately after a like / dislike', () => {
    const base = rank([]);
    const q0 = selectQueue(base.scored, base.profile, { count: 3, exclude: new Set(), recentArtists: [] }).map((s) => s.track.id);
    const liked = rank([sig('like', byId('b1'))]);
    const q1 = selectQueue(liked.scored, liked.profile, { count: 3, exclude: new Set(['mock:b1']), recentArtists: [] }).map((s) => s.track.id);
    expect(q1[0]).toBe('mock:b2');
    expect(q1).not.toEqual(q0);
    const disliked = rank([sig('dislike', byId(q0[0]!.slice(5)))]);
    const q2 = selectQueue(disliked.scored, disliked.profile, { count: 3, exclude: new Set(), recentArtists: [] }).map((s) => s.track.id);
    expect(q2).not.toContain(q0[0]);
  });
});
