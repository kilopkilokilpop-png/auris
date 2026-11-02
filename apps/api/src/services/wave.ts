import type { Mood, Track, WaveItem, WaveMode } from '@auris/shared';
import { TtlCache } from '../lib/http.js';
import { GENRE_NAMES_RU } from '../providers/music/genres.js';
import type { CompositeProvider } from '../providers/music/registry.js';
import { buildProfile, scoreTrack, selectQueue, type TasteProfile } from '../reco/scoring.js';
import { MOOD_KEYWORDS, RECO_WEIGHTS } from '../reco/weights.js';
import type { Catalog } from './catalog.js';
import type { Store } from './store.js';

const top = (m: Map<string, number>, n: number) => [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

/**
 * Candidate sources (no closed recommendation APIs):
 *  1. provider charts; 2. top tracks of liked artists; 3. related artists (provider);
 *  4. favourite genres; 5. mood tags; 6. user's own history/likes; 7. onboarding picks.
 *  (Collaborative filtering over similar users is a planned 8th source.)
 */
export class WaveService {
  private pools = new TtlCache<Track[]>(3 * 60_000, 500);

  constructor(
    private readonly music: CompositeProvider,
    private readonly store: Store,
    private readonly catalog: Catalog,
  ) {}

  invalidate(userId: number) {
    for (const mood of Object.keys(MOOD_KEYWORDS).concat('any')) this.pools.delete(`${userId}:${mood}`);
  }

  private async pool(userId: number, profile: TasteProfile, mood: Mood, onboarding: { genres: string[]; artists: string[] }): Promise<Track[]> {
    const key = `${userId}:${mood}`;
    const cached = this.pools.get(key);
    if (cached) return cached;
    const safe = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    const likedArtists = top(profile.artist, 4);
    const seedArtists = [...new Set([...likedArtists, ...onboarding.artists])].slice(0, 5);
    const genres = [...new Set([...top(profile.genre, 3), ...onboarding.genres])].slice(0, 4);

    const related = (await Promise.all(seedArtists.slice(0, 3).map((a) => safe(this.music.getRelatedArtists(a, 4))))).flat();
    const lists = await Promise.all([
      safe(this.music.getChart(40)),
      ...seedArtists.map((a) => safe(this.music.getArtistTopTracks(a, 6))),
      ...related.slice(0, 8).map((a) => safe(this.music.getArtistTopTracks(a.id, 3))),
      ...genres.map((g) => safe(this.music.getGenreTracks(g, 15))),
      mood !== 'any' ? safe(this.music.getTagTracks(MOOD_KEYWORDS[mood].slice(0, 3), 25)) : Promise.resolve([]),
      this.store.likedIds(userId, 40).then((ids) => this.catalog.hydrate(ids)).catch(() => []),
    ]);
    const map = new Map<string, Track>();
    for (const t of lists.flat()) if (!map.has(t.id)) map.set(t.id, t);
    const pool = [...map.values()];
    this.pools.set(key, pool);
    return pool;
  }

  async next(userId: number, req: { mood: Mood; mode: WaveMode; exclude: string[]; recentArtists: string[]; count: number }): Promise<WaveItem[]> {
    const [signals, user, recent] = await Promise.all([
      this.store.signals(userId),
      this.store.getUserRow(userId),
      this.store.recentlyPlayed(userId, RECO_WEIGHTS.recentHistory),
    ]);
    const profile = buildProfile(signals);
    const onboarding = { genres: user?.onboarding_genres ?? [], artists: user?.onboarding_artists ?? [] };
    const pool = await this.pool(userId, profile, req.mood, onboarding);
    const seed = `${userId}:${new Date().toISOString().slice(0, 13)}`;
    const scored = pool.map((t) => scoreTrack(t, { profile, mood: req.mood, mode: req.mode, onboarding, seed, genreNames: GENRE_NAMES_RU }));
    let picked = selectQueue(scored, profile, { count: req.count, exclude: new Set([...req.exclude, ...recent]), recentArtists: req.recentArtists });
    if (picked.length < req.count) {
      // Small catalogues: allow tracks heard earlier in the session history, never the client's queue.
      picked = selectQueue(scored, profile, { count: req.count, exclude: new Set(req.exclude), recentArtists: req.recentArtists });
    }
    await this.store.saveSnapshots(picked.map((p) => p.track));
    return picked.map((p) => ({ track: p.track, score: Math.round(p.score * 1000) / 1000, reasons: p.reasons }));
  }
}
