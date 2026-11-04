import type { Album, Artist, Genre, QualityTier, Track } from '@auris/shared';
import { OutboundLimiter, UpstreamError } from '../../lib/http.js';
import { GENRE_NAMES_RU } from './genres.js';
import { stripPrefix, type MusicProvider, type ProviderInfo, type RecognizedHint, type SearchResult, type StreamSource } from './MusicProvider.js';

/**
 * YouTube Data API v3 + the official IFrame Player (client side). Read before changing:
 *  - YouTube API Services Terms + Developer Policies (developers.google.com/youtube/terms/developer-policies)
 *  - Required Minimum Functionality (…/required-minimum-functionality), Branding Guidelines.
 * What this adapter guarantees:
 *  - metadata only: playback.kind = 'embed'. No stream URL, no audio, nothing downloaded or cached (II.I.7, III.E.1);
 *  - titles / channel names are passed through unchanged (no "cleaning" of API data);
 *  - no YouTube statistics are read: popularity is a neutral constant (III.E.4.h, no derived metrics);
 *  - only public, processed, embeddable videos not blocked in YOUTUBE_REGION are returned;
 *  - status.madeForKids is looked up for every video we hand out (III.E.4.j);
 *  - API data is kept in memory for hours and in the DB at most YOUTUBE_DATA_MAX_AGE_DAYS (≤ 30, III.E.4.d);
 *  - quota exhaustion is reported as YouTubeQuotaError; stale cache (≤ 30 days) may be served instead.
 *    Never create extra Google Cloud projects to get more quota (III.D.1.c).
 */
const P = 'youtube';
const BASE = 'https://www.googleapis.com/youtube/v3';
const DAY = 86_400_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export class YouTubeQuotaError extends UpstreamError {
  readonly code = 'YOUTUBE_QUOTA';
  constructor() {
    super('YouTube API quota exceeded', 403);
  }
}

export interface YtVideo {
  id: string;
  snippet?: {
    title: string;
    channelId: string;
    channelTitle: string;
    thumbnails?: Record<string, { url: string; width?: number; height?: number }>;
    liveBroadcastContent?: string;
  };
  contentDetails?: { duration?: string; regionRestriction?: { allowed?: string[]; blocked?: string[] } };
  status?: { uploadStatus?: string; privacyStatus?: string; embeddable?: boolean; madeForKids?: boolean };
}
interface YtChannel { id: string; snippet?: { title: string; thumbnails?: Record<string, { url: string }> } }
interface YtSearchItem { id: { kind: string; videoId?: string; channelId?: string } }
interface YtList<T> { items?: T[]; nextPageToken?: string }

export type YtFetch = (url: string) => Promise<{ status: number; body: unknown }>;

const defaultFetch: YtFetch = async (url) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    // Server-to-server call: the key is sent only from here, never to the Mini App.
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (e) {
    throw new UpstreamError((e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
};

/** ISO-8601 "PT1H2M3S" -> seconds. */
export function isoDuration(s?: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s ?? '');
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + +(m[4] ?? 0);
}

/** Why a video cannot be offered in AURIS, or null when it can. */
export function videoUnavailable(v: YtVideo, region: string): string | null {
  const st = v.status;
  if (!v.snippet || !st) return 'Видео недоступно';
  if (st.privacyStatus !== 'public' || (st.uploadStatus && st.uploadStatus !== 'processed')) return 'Видео скрыто или удалено';
  if (st.embeddable === false) return 'Автор запретил встраивание видео';
  if (v.snippet.liveBroadcastContent && v.snippet.liveBroadcastContent !== 'none') return 'Прямые эфиры не поддерживаются';
  const rr = v.contentDetails?.regionRestriction;
  if (rr?.blocked?.includes(region) || (rr?.allowed && !rr.allowed.includes(region))) return 'Видео недоступно в вашем регионе';
  return null;
}

/** Cache with a fresh window and a hard limit of ≤ 30 days (stale entries are used only when the quota is out). */
class StaleCache<V> {
  private map = new Map<string, { v: V; at: number }>();
  constructor(
    private freshMs: number,
    private maxMs: number,
    private max = 3000,
  ) {}
  get(k: string, allowStale = false): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    const age = Date.now() - e.at;
    if (age > this.maxMs) {
      this.map.delete(k);
      return undefined;
    }
    return age <= this.freshMs || allowStale ? e.v : undefined;
  }
  set(k: string, v: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(k, { v, at: Date.now() });
  }
}

export class YouTubeProvider implements MusicProvider {
  readonly info: ProviderInfo = {
    id: 'youtube',
    name: 'YouTube',
    fullStreams: true,
    previewsOnly: false,
    separateResults: true,
    notice: 'YouTube: видео играют только в официальном плеере YouTube, пока он открыт на экране.',
    // No real quality data: the UI hides quality controls and badges for YouTube.
    maxTier: 'standard',
  };
  private limiter = new OutboundLimiter(10, 1000);
  private videos: StaleCache<YtVideo | null>;
  private lists: StaleCache<string[]>;
  private pageTokens = new Map<string, string>();

  constructor(
    private readonly key: string,
    private readonly region = 'RU',
    maxAgeDays = 29,
    private readonly fetcher: YtFetch = defaultFetch,
  ) {
    const hard = Math.min(30, maxAgeDays) * DAY;
    this.videos = new StaleCache(6 * 3600_000, hard);
    this.lists = new StaleCache(12 * 3600_000, hard);
  }

  owns(id: string) {
    return id.startsWith(P + ':');
  }

  private async call<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const qs = new URLSearchParams({ key: this.key });
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    await this.limiter.take();
    const r = await this.fetcher(`${BASE}${path}?${qs}`);
    if (r.status === 200) return r.body as T;
    const reason = (r.body as { error?: { errors?: { reason?: string }[] } })?.error?.errors?.[0]?.reason;
    if (r.status === 403 && (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'rateLimitExceeded')) throw new YouTubeQuotaError();
    throw new UpstreamError(`YouTube API ${r.status}${reason ? ` ${reason}` : ''}`, r.status);
  }

  /** videos.list for up to 50 ids (1 quota unit per call). Unknown / gone ids map to null. */
  async fetchVideos(ids: string[], force = false): Promise<Map<string, YtVideo | null>> {
    const out = new Map<string, YtVideo | null>();
    const need: string[] = [];
    for (const id of ids) {
      const hit = force ? undefined : this.videos.get(id);
      if (hit !== undefined) out.set(id, hit);
      else need.push(id);
    }
    for (let i = 0; i < need.length; i += 50) {
      const chunk = need.slice(i, i + 50);
      let res: YtList<YtVideo>;
      try {
        res = await this.call<YtList<YtVideo>>('/videos', { part: 'snippet,contentDetails,status', id: chunk.join(','), maxResults: 50 });
      } catch (e) {
        if (e instanceof YouTubeQuotaError) for (const id of chunk) {
          const stale = this.videos.get(id, true);
          if (stale !== undefined) out.set(id, stale);
        }
        if (e instanceof YouTubeQuotaError && chunk.every((id) => out.has(id))) continue;
        throw e;
      }
      const got = new Map((res.items ?? []).map((v) => [v.id, v]));
      for (const id of chunk) {
        const v = got.get(id) ?? null;
        this.videos.set(id, v);
        out.set(id, v);
      }
    }
    return out;
  }

  toTrack(v: YtVideo, extra: { genres?: string[] } = {}): Track {
    const sn = v.snippet!;
    const th = sn.thumbnails ?? {};
    const duration = isoDuration(v.contentDetails?.duration);
    return {
      id: `${P}:${v.id}`,
      provider: 'youtube',
      // YouTube data is shown as returned by the API.
      title: sn.title,
      artist: { id: `${P}:${sn.channelId}`, name: sn.channelTitle },
      durationSec: duration,
      coverUrl: (th.high ?? th.medium ?? th.default)?.url,
      genres: extra.genres ?? [],
      tags: [],
      // Neutral constant: AURIS never derives rankings from YouTube statistics.
      popularity: 0.5,
      playback: { kind: 'embed', playableSec: duration, qualities: [], note: 'Воспроизводится в официальном плеере YouTube' },
      license: {
        name: 'YouTube',
        url: 'https://www.youtube.com/t/terms',
        attribution: sn.channelTitle,
        sourceUrl: `https://www.youtube.com/watch?v=${v.id}`,
      },
      youtube: { videoId: v.id, channelId: sn.channelId, channelTitle: sn.channelTitle, madeForKids: v.status?.madeForKids === true, fetchedAt: new Date().toISOString() },
    };
  }

  /** search.list (100 units) -> videos.list (1 unit) for status / duration / madeForKids. */
  private async searchVideos(q: string, opts: { limit: number; offset?: number; channelId?: string; genres?: string[] }): Promise<Track[]> {
    const limit = Math.min(25, Math.max(1, opts.limit));
    const page = Math.floor((opts.offset ?? 0) / limit);
    const key = `s|${q}|${opts.channelId ?? ''}|${limit}|${page}`;
    let ids = this.lists.get(key);
    if (!ids) {
      const prevKey = `s|${q}|${opts.channelId ?? ''}|${limit}|${page - 1}`;
      const pageToken = page > 0 ? this.pageTokens.get(prevKey) : undefined;
      if (page > 0 && !pageToken) return [];
      try {
        const r = await this.call<YtList<YtSearchItem>>('/search', {
          part: 'id',
          type: 'video',
          q: q || undefined,
          channelId: opts.channelId,
          maxResults: limit,
          pageToken,
          videoEmbeddable: 'true',
          videoSyndicated: 'true',
          videoCategoryId: opts.channelId ? undefined : 10,
          regionCode: this.region,
          safeSearch: 'moderate',
        });
        ids = (r.items ?? []).map((i) => i.id.videoId).filter((x): x is string => !!x && VIDEO_ID.test(x));
        if (r.nextPageToken) this.pageTokens.set(key, r.nextPageToken);
        this.lists.set(key, ids);
      } catch (e) {
        const stale = e instanceof YouTubeQuotaError ? this.lists.get(key, true) : undefined;
        if (!stale) throw e;
        ids = stale;
      }
    }
    const vids = await this.fetchVideos(ids);
    return ids.map((id) => vids.get(id)).filter((v): v is YtVideo => !!v && !videoUnavailable(v, this.region)).map((v) => this.toTrack(v, { genres: opts.genres }));
  }

  async search(query: string, opts: { type: 'all' | 'track' | 'artist' | 'album'; limit: number; offset?: number }): Promise<SearchResult> {
    const tracks = opts.type === 'all' || opts.type === 'track' ? await this.searchVideos(query, opts) : [];
    let artists: Artist[] = [];
    if (opts.type === 'artist') {
      const key = `c|${query}`;
      let ids = this.lists.get(key);
      if (!ids) {
        const r = await this.call<YtList<YtSearchItem>>('/search', { part: 'id', type: 'channel', q: query, maxResults: Math.min(10, opts.limit), regionCode: this.region });
        ids = (r.items ?? []).map((i) => i.id.channelId).filter((x): x is string => !!x && CHANNEL_ID.test(x));
        this.lists.set(key, ids);
      }
      artists = (await Promise.all(ids.map((id) => this.getArtist(`${P}:${id}`).catch(() => null)))).filter((a): a is Artist => !!a);
    }
    return { tracks, artists, albums: [] };
  }

  async getTrack(id: string): Promise<Track | null> {
    const vid = stripPrefix(id, P);
    if (!VIDEO_ID.test(vid)) return null;
    const v = (await this.fetchVideos([vid])).get(vid);
    return v && !videoUnavailable(v, this.region) ? this.toTrack(v) : null;
  }

  /** Retention job: re-fetch stored ids. `gone` = deleted / private / not embeddable / blocked -> must be forgotten. */
  async refresh(ids: string[]): Promise<{ fresh: Track[]; gone: string[] }> {
    const vids = ids.map((id) => stripPrefix(id, P)).filter((v) => VIDEO_ID.test(v));
    const got = await this.fetchVideos(vids, true);
    const fresh: Track[] = [];
    const gone: string[] = ids.filter((id) => !VIDEO_ID.test(stripPrefix(id, P)));
    for (const vid of vids) {
      const v = got.get(vid);
      if (v && !videoUnavailable(v, this.region)) fresh.push(this.toTrack(v));
      else gone.push(`${P}:${vid}`);
    }
    return { fresh, gone };
  }

  async getAlbum(): Promise<Album | null> {
    return null;
  }
  async getArtist(id: string): Promise<Artist | null> {
    const cid = stripPrefix(id, P);
    if (!CHANNEL_ID.test(cid)) return null;
    const r = await this.call<YtList<YtChannel>>('/channels', { part: 'snippet', id: cid });
    const c = r.items?.[0];
    if (!c?.snippet) return null;
    const th = c.snippet.thumbnails ?? {};
    return { id: `${P}:${c.id}`, provider: 'youtube', name: c.snippet.title, pictureUrl: (th.high ?? th.medium ?? th.default)?.url, genres: [] };
  }
  async getArtistTopTracks(id: string, limit: number) {
    const cid = stripPrefix(id, P);
    if (!CHANNEL_ID.test(cid)) return [];
    return this.searchVideos('', { limit, channelId: cid });
  }
  /** The Data API has no "related artists": we do not imitate one. */
  async getRelatedArtists() {
    return [];
  }
  /** chart=mostPopular in the Music category: YouTube's own chart, shown as is (1 unit). */
  async getChart(limit: number) {
    const key = `chart|${limit}`;
    let ids = this.lists.get(key);
    if (!ids) {
      const r = await this.call<YtList<YtVideo>>('/videos', { part: 'snippet,contentDetails,status', chart: 'mostPopular', videoCategoryId: 10, regionCode: this.region, maxResults: Math.min(50, limit) });
      for (const v of r.items ?? []) this.videos.set(v.id, v);
      ids = (r.items ?? []).map((v) => v.id);
      this.lists.set(key, ids);
    }
    const vids = await this.fetchVideos(ids);
    return ids.map((id) => vids.get(id)).filter((v): v is YtVideo => !!v && !videoUnavailable(v, this.region)).map((v) => this.toTrack(v));
  }
  async getChartArtists() {
    return [];
  }
  async getGenres(): Promise<Genre[]> {
    return [];
  }
  /** Search by the genre name the user picked/liked (a regular search, 100 units, cached 12 h for everyone). */
  async getGenreTracks(genre: string, limit: number, offset = 0) {
    return this.searchVideos(`${GENRE_NAMES_RU[genre] ?? genre} музыка`, { limit, offset, genres: [genre] });
  }
  async getEditorial() {
    return null;
  }
  /** Never a stream: YouTube plays only in the official, visible IFrame player. */
  async getStream(_id: string, _tier: QualityTier): Promise<StreamSource | null> {
    void _id;
    void _tier;
    return null;
  }
  /** Not used for recognition: the user explicitly taps "Найти на YouTube". */
  async match(_hint: RecognizedHint) {
    void _hint;
    return null;
  }
}
