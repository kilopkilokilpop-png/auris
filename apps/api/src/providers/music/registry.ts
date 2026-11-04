import path from 'node:path';
import type { Album, Artist, Genre, ProviderId, QualityTier, Track } from '@auris/shared';
import type { Env } from '../../config/env.js';
import { AudiusProvider } from './AudiusProvider.js';
import { DeezerProvider } from './DeezerProvider.js';
import { JamendoProvider } from './JamendoProvider.js';
import { LicensedProvider } from './LicensedProvider.js';
import { MockMedia } from './mock-media.js';
import { MockProvider } from './MockProvider.js';
import { YouTubeProvider } from './YouTubeProvider.js';
import { fixtureFetch } from './youtube-fixtures.js';
import type { MusicProvider, ProviderInfo, RecognizedHint, SearchResult, StreamSource } from './MusicProvider.js';

/** Interleave lists so every source is represented near the top. */
function interleave<T>(lists: T[][], limit: number): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < limit) out.push(l[i]!);
  }
  return out;
}

async function settle<T>(ps: Promise<T>[]): Promise<T[]> {
  const r = await Promise.allSettled(ps);
  const ok: T[] = [];
  for (const x of r) if (x.status === 'fulfilled') ok.push(x.value as T);
  if (ok.length === 0 && r.length > 0) throw (r[0] as PromiseRejectedResult).reason;
  return ok;
}

/**
 * Routes calls to adapters by id prefix and merges list endpoints.
 * Itself a MusicProvider, so consumers never know how many sources there are.
 */
export class CompositeProvider implements MusicProvider {
  readonly info: ProviderInfo;
  /** Sources whose results may be merged into one list (everything except YouTube). */
  readonly mergeable: MusicProvider[];
  /** Sources shown only in their own section (YouTube). */
  readonly separate: MusicProvider[];
  constructor(readonly providers: MusicProvider[]) {
    if (providers.length === 0) throw new Error('No music providers configured');
    this.info = { ...providers[0]!.info };
    this.mergeable = providers.filter((p) => !p.info.separateResults);
    this.separate = providers.filter((p) => p.info.separateResults);
  }
  owns(id: string) {
    return this.providers.some((p) => p.owns(id));
  }
  byId(id: string): MusicProvider | undefined {
    return this.providers.find((p) => p.owns(id));
  }
  get(providerId: ProviderId) {
    return this.providers.find((p) => p.info.id === providerId);
  }
  private route(id: string): MusicProvider {
    const p = this.byId(id);
    if (!p) throw Object.assign(new Error('Unknown provider for id'), { statusCode: 404 });
    return p;
  }

  async search(q: string, opts: { type: 'all' | 'track' | 'artist' | 'album'; limit: number; offset?: number }): Promise<SearchResult> {
    const rs = await settle(this.mergeable.map((p) => p.search(q, opts)));
    return {
      tracks: interleave(rs.map((r) => r.tracks), opts.limit),
      artists: interleave(rs.map((r) => r.artists), opts.limit),
      albums: interleave(rs.map((r) => r.albums), opts.limit),
    };
  }
  getTrack(id: string) {
    return this.byId(id)?.getTrack(id) ?? Promise.resolve(null);
  }
  getAlbum(id: string) {
    return this.byId(id)?.getAlbum(id) ?? Promise.resolve(null);
  }
  getArtist(id: string) {
    return this.byId(id)?.getArtist(id) ?? Promise.resolve(null);
  }
  getArtistTopTracks(id: string, limit: number) {
    return this.route(id).getArtistTopTracks(id, limit);
  }
  getRelatedArtists(id: string, limit: number) {
    return this.route(id).getRelatedArtists(id, limit);
  }
  async getChart(limit: number): Promise<Track[]> {
    return interleave(await settle(this.mergeable.map((p) => p.getChart(limit))), limit);
  }
  async getChartArtists(limit: number): Promise<Artist[]> {
    return interleave(await settle(this.mergeable.map((p) => p.getChartArtists(limit))), limit);
  }
  async getGenres(): Promise<Genre[]> {
    const all = (await settle(this.mergeable.map((p) => p.getGenres()))).flat();
    return [...new Map(all.map((g) => [g.id, g])).values()];
  }
  // Paged lists: every source returns its own page; the merged page can hold up to limit x sources.
  async getGenreTracks(genre: string, limit: number, offset = 0): Promise<Track[]> {
    const lists = await settle(this.mergeable.map((p) => p.getGenreTracks(genre, limit, offset)));
    return interleave(lists, limit * lists.length);
  }
  async getLanguageTracks(lang: string, limit: number, offset = 0): Promise<Track[]> {
    const lists = await settle(this.mergeable.filter((p) => p.getLanguageTracks).map((p) => p.getLanguageTracks!(lang, limit, offset)));
    return interleave(lists, limit * lists.length);
  }
  async getTagTracks(tags: string[], limit: number, offset = 0): Promise<Track[]> {
    const lists = await settle(this.mergeable.filter((p) => p.getTagTracks).map((p) => p.getTagTracks!(tags, limit, offset)));
    return interleave(lists, limit * lists.length);
  }
  async getEditorial(): Promise<Album | null> {
    for (const p of this.mergeable) {
      const a = await p.getEditorial().catch(() => null);
      if (a) return a;
    }
    return null;
  }
  getStream(id: string, tier: QualityTier): Promise<StreamSource | null> {
    return this.byId(id)?.getStream(id, tier) ?? Promise.resolve(null);
  }
  async match(hint: RecognizedHint): Promise<Track | null> {
    let fallback: Track | null = null;
    for (const p of this.mergeable) {
      const t = await p.match(hint).catch(() => null);
      if (t && t.playback.kind === 'full') return t;
      fallback ??= t;
    }
    return fallback;
  }
}

export function createMusicProvider(env: Env): CompositeProvider {
  const ids = env.MUSIC_PROVIDERS.split(',').map((s) => s.trim()).filter(Boolean);
  const list: MusicProvider[] = [];
  for (const id of ids) {
    switch (id) {
      case 'mock':
        list.push(new MockProvider(new MockMedia(path.join(env.DATA_DIR, 'mock-media'), env.FFMPEG_PATH)));
        break;
      case 'deezer':
        if (!env.DEEZER_ENABLED_NONCOMMERCIAL) {
          throw new Error('Deezer API terms allow non-commercial use only. Set DEEZER_ENABLED_NONCOMMERCIAL=true to confirm.');
        }
        list.push(new DeezerProvider());
        break;
      case 'youtube':
        if (env.YOUTUBE_API_KEY) list.push(new YouTubeProvider(env.YOUTUBE_API_KEY, env.YOUTUBE_REGION, env.YOUTUBE_DATA_MAX_AGE_DAYS));
        else if (env.NODE_ENV !== 'production') {
          // pnpm dev without keys: canned metadata, real official player.
          console.warn('[auris] YOUTUBE_API_KEY is empty: YouTube runs on dev fixtures (development only).');
          list.push(new YouTubeProvider('dev-fixtures', env.YOUTUBE_REGION, env.YOUTUBE_DATA_MAX_AGE_DAYS, fixtureFetch));
        } else throw new Error('YOUTUBE_API_KEY is required for the youtube provider');
        break;
      case 'jamendo':
        if (!env.JAMENDO_CLIENT_ID) throw new Error('JAMENDO_CLIENT_ID is required for the jamendo provider');
        list.push(new JamendoProvider(env.JAMENDO_CLIENT_ID));
        break;
      case 'audius':
        list.push(new AudiusProvider(env.AUDIUS_APP_NAME));
        break;
      case 'licensed':
        list.push(new LicensedProvider({ url: env.LICENSED_API_URL, key: env.LICENSED_API_KEY }));
        break;
      default:
        throw new Error(`Unknown music provider "${id}"`);
    }
  }
  return new CompositeProvider(list);
}
