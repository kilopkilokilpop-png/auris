import type { Mood, Track, WaveMode } from '@auris/shared';
import { MOOD_KEYWORDS, RECO_WEIGHTS } from './weights.js';

export type SignalKind = keyof typeof RECO_WEIGHTS.signals | 'skip';

export interface Signal {
  kind: 'play_start' | 'play_complete' | 'skip' | 'repeat' | 'like' | 'unlike' | 'dislike' | 'playlist_add' | 'recognized';
  trackId: string;
  artistId?: string | null;
  genres?: string[];
  tags?: string[];
  positionSec?: number | null;
  durationSec?: number | null;
  at: Date;
}

export interface TasteProfile {
  track: Map<string, number>;
  artist: Map<string, number>;
  genre: Map<string, number>;
  tag: Map<string, number>;
  liked: Set<string>;
  disliked: Set<string>;
  /** Raw (un-squashed) totals, useful for debugging & tests. */
  eventCount: number;
}

export interface Onboarding {
  genres: string[];
  artists: string[];
}

type W = typeof RECO_WEIGHTS;

export function signalValue(s: Signal, w: W = RECO_WEIGHTS): number {
  if (s.kind === 'skip') {
    const pos = s.positionSec ?? 0;
    const dur = s.durationSec ?? 0;
    const early = pos < w.earlySkipSec || (dur > 0 && pos / dur < w.earlySkipShare);
    return early ? w.signals.earlySkip : w.signals.lateSkip;
  }
  return w.signals[s.kind];
}

export function decay(at: Date, now: Date, w: W = RECO_WEIGHTS): number {
  const days = Math.max(0, (now.getTime() - at.getTime()) / 86_400_000);
  return Math.pow(0.5, days / w.halfLifeDays);
}

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const squash = (m: Map<string, number>, scale: number) => {
  for (const [k, v] of m) m.set(k, Math.tanh(v / scale));
};

export function buildProfile(signals: Signal[], now = new Date(), w: W = RECO_WEIGHTS): TasteProfile {
  const p: TasteProfile = { track: new Map(), artist: new Map(), genre: new Map(), tag: new Map(), liked: new Set(), disliked: new Set(), eventCount: signals.length };
  // Chronological so like/unlike resolve to the latest state.
  const sorted = [...signals].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const s of sorted) {
    const v = signalValue(s, w) * decay(s.at, now, w);
    add(p.track, s.trackId, v);
    if (s.artistId) add(p.artist, s.artistId, v * w.spread.artist);
    for (const g of s.genres ?? []) add(p.genre, g, v * w.spread.genre);
    for (const t of s.tags ?? []) add(p.tag, t, v * w.spread.tag);
    if (s.kind === 'like') {
      p.liked.add(s.trackId);
      p.disliked.delete(s.trackId);
    } else if (s.kind === 'unlike') p.liked.delete(s.trackId);
    else if (s.kind === 'dislike') {
      p.disliked.add(s.trackId);
      p.liked.delete(s.trackId);
    }
  }
  squash(p.track, w.affinityScale.track);
  squash(p.artist, w.affinityScale.artist);
  squash(p.genre, w.affinityScale.genre);
  squash(p.tag, w.affinityScale.tag);
  return p;
}

export function moodMatch(track: Pick<Track, 'genres' | 'tags'>, mood: Mood): number {
  if (mood === 'any') return 0;
  const kw = MOOD_KEYWORDS[mood];
  const words = [...track.genres, ...track.tags].map((x) => x.toLowerCase());
  if (words.length === 0) return 0;
  const hits = words.filter((x) => kw.includes(x)).length;
  return hits > 0 ? Math.min(1, 0.5 + hits * 0.25) : -0.5;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Stable pseudo-random in [0,1) from a string — keeps tests deterministic. */
export function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

export interface Scored {
  track: Track;
  score: number;
  reasons: string[];
}

export interface ScoreContext {
  profile: TasteProfile;
  mood: Mood;
  mode: WaveMode;
  onboarding?: Onboarding;
  seed?: string;
  genreNames?: Record<string, string>;
}

export function scoreTrack(track: Track, ctx: ScoreContext, w: W = RECO_WEIGHTS): Scored {
  const { profile: p } = ctx;
  const m = w.modes[ctx.mode];
  const reasons: { text: string; weight: number }[] = [];

  const aArtist = p.artist.get(track.artist.id) ?? 0;
  const aGenre = avg(track.genres.map((g) => p.genre.get(g) ?? 0));
  const aTag = avg(track.tags.map((t) => p.tag.get(t) ?? 0));
  const aTrack = p.track.get(track.id) ?? 0;
  const familiarity = w.score.artist * aArtist + w.score.genre * aGenre + w.score.tag * aTag + w.score.track * aTrack;

  const knownArtist = p.artist.has(track.artist.id) && aArtist > 0.05;
  const known = p.liked.has(track.id);
  const novelty = knownArtist || p.track.has(track.id) ? 0 : 1;

  let score = m.familiarity * familiarity + m.novelty * novelty + (known ? m.knownTrack : 0);
  score += w.score.popularity * track.popularity;

  const mood = moodMatch(track, ctx.mood);
  score += w.score.mood * mood;

  if (ctx.onboarding) {
    if (ctx.onboarding.artists.includes(track.artist.id)) {
      score += w.score.onboardingArtist;
      reasons.push({ text: `Вы выбрали ${track.artist.name}`, weight: w.score.onboardingArtist });
    }
    const g = track.genres.find((x) => ctx.onboarding!.genres.includes(x));
    if (g) {
      score += w.score.onboardingGenre;
      reasons.push({ text: `Жанр из ваших интересов: ${ctx.genreNames?.[g] ?? g}`, weight: w.score.onboardingGenre });
    }
  }
  score += w.jitter * (hashUnit(`${ctx.seed ?? ''}:${track.id}`) - 0.5);

  if (aArtist > 0.1) reasons.push({ text: `Вам нравится ${track.artist.name}`, weight: aArtist * w.score.artist });
  if (aArtist < -0.1) reasons.push({ text: `Вы часто пропускаете ${track.artist.name}`, weight: -aArtist });
  if (aGenre > 0.1) {
    const top = track.genres.reduce((b, g) => ((p.genre.get(g) ?? 0) > (p.genre.get(b) ?? 0) ? g : b), track.genres[0]!);
    reasons.push({ text: `Похоже на любимый жанр: ${ctx.genreNames?.[top] ?? top}`, weight: aGenre * w.score.genre });
  }
  if (novelty && m.novelty > 0) reasons.push({ text: 'Новый для вас артист', weight: m.novelty * 0.5 });
  if (known && m.knownTrack > 0) reasons.push({ text: 'Из вашего избранного', weight: m.knownTrack });
  if (mood > 0) reasons.push({ text: 'Подходит под настроение', weight: mood * w.score.mood });
  if (track.popularity > 0.7) reasons.push({ text: 'Популярно сейчас', weight: track.popularity * w.score.popularity * 0.5 });

  return {
    track,
    score,
    reasons: reasons.sort((a, b) => b.weight - a.weight).slice(0, 3).map((r) => r.text),
  };
}

export interface SelectOptions {
  count: number;
  exclude: Set<string>;
  /** Artists of the last tracks already in the queue (most recent last). */
  recentArtists: string[];
}

/**
 * Greedy pick by score with constraints: never disliked/excluded/recent;
 * same artist not within `artistWindow`. Relaxes the artist rule only if nothing else is left.
 */
export function selectQueue(scored: Scored[], profile: TasteProfile, opts: SelectOptions, w: W = RECO_WEIGHTS): Scored[] {
  const pool = scored
    .filter((s) => !opts.exclude.has(s.track.id) && !profile.disliked.has(s.track.id) && s.track.playback.kind !== 'none')
    .sort((a, b) => b.score - a.score);
  const out: Scored[] = [];
  const window = [...opts.recentArtists];
  const used = new Set<string>();
  while (out.length < opts.count) {
    const recent = new Set(window.slice(-(w.artistWindow - 1)));
    let idx = pool.findIndex((s) => !used.has(s.track.id) && !recent.has(s.track.artist.id));
    if (idx < 0) idx = pool.findIndex((s) => !used.has(s.track.id) && s.track.artist.id !== window[window.length - 1]);
    if (idx < 0) break;
    const pick = pool[idx]!;
    used.add(pick.track.id);
    out.push(pick);
    window.push(pick.track.artist.id);
  }
  return out;
}
