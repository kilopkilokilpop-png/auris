import type { Album, Artist, Genre, QualityTier, Track } from '@auris/shared';
import { fetchJson, OutboundLimiter, TtlCache, UpstreamError } from '../../lib/http.js';
import { canonicalGenre, GENRE_NAMES_RU } from './genres.js';
import { stripPrefix, type DownloadDecision, type MusicProvider, type ProviderInfo, type RecognizedHint, type SearchResult, type StreamSource } from './MusicProvider.js';

/**
 * Audius (https://docs.audius.co) — open music network where artists upload their own tracks.
 * Its REST API lets any app "query, stream, and search for tracks" (requires `app_name`).
 * Rules applied here:
 *  - only tracks that are streamable and NOT gated (paid / follow-gated) are offered;
 *  - full-length playback through the API stream endpoint, proxied by our server;
 *  - downloads to Telegram are OFF: re-distributing files is not explicitly granted -> unknown rights = deny;
 *  - attribution: artist + backlink to the track page on audius.co.
 */
const P = 'audius';
const SITE = 'https://audius.co';

interface AuUser { id: string; name: string; handle?: string; profile_picture?: Record<string, string> | null; follower_count?: number }
export interface AuTrack {
  id: string;
  title: string;
  duration: number;
  genre?: string | null;
  mood?: string | null;
  tags?: string | null;
  play_count?: number;
  permalink?: string;
  artwork?: Record<string, string> | null;
  user: AuUser;
  isrc?: string | null;
  is_streamable?: boolean;
  is_stream_gated?: boolean;
  is_delete?: boolean;
  is_unlisted?: boolean;
  is_available?: boolean;
}
interface AuPlaylist { id: string; playlist_name: string; is_album?: boolean; user: AuUser; artwork?: Record<string, string> | null; track_count?: number; permalink?: string; release_date?: string | null }

/** Audius moods -> our mood/tag vocabulary (see reco/weights MOOD_KEYWORDS). */
const MOOD_TAGS: Record<string, string[]> = {
  Peaceful: ['calm', 'relaxing'], Tender: ['calm', 'romantic'], Easygoing: ['calm', 'chill'], Romantic: ['romantic'],
  Sentimental: ['sad', 'emotional'], Yearning: ['sad'], Melancholy: ['sad', 'melancholic'], Brooding: ['dark', 'sad'],
  Serious: ['dark', 'focus'], Gritty: ['dark'], Cool: ['chill', 'focus'], Sophisticated: ['focus', 'jazz'], Sensual: ['romantic'],
  Energizing: ['energetic', 'workout'], Upbeat: ['energetic', 'happy'], Excited: ['energetic', 'happy'], Empowering: ['energetic', 'motivational'],
  Stirring: ['energetic'], Fiery: ['energetic', 'workout'], Defiant: ['energetic', 'workout'], Aggressive: ['workout'], Rowdy: ['energetic', 'party'],
};
/** Our canonical genre -> Audius genre name for genre charts. */
const GENRE_TO_AUDIUS: Record<string, string> = {
  electronic: 'Electronic', hiphop: 'Hip-Hop/Rap', pop: 'Pop', rock: 'Rock', indie: 'Alternative', rnb: 'R&B/Soul', jazz: 'Jazz',
  classical: 'Classical', ambient: 'Ambient', lofi: 'Lo-Fi', latin: 'Latin', metal: 'Metal', folk: 'Folk', soundtrack: 'Soundtrack',
  dance: 'Dance', house: 'House', techno: 'Techno', reggae: 'Reggae', blues: 'Blues', country: 'Country',
};

export function audiusPlayable(t: AuTrack): boolean {
  return t.is_streamable !== false && !t.is_stream_gated && !t.is_delete && !t.is_unlisted && t.is_available !== false;
}

export class AudiusProvider implements MusicProvider {
  readonly info: ProviderInfo = {
    id: 'audius',
    name: 'Audius',
    fullStreams: true,
    previewsOnly: false,
    downloads: false,
    notice: 'Audius: полные треки, которые артисты сами выкладывают в открытую сеть Audius. Скачивание в Telegram недоступно.',
    maxTier: 'standard',
    tiers: { standard: 'MP3' },
  };
  private cache = new TtlCache<unknown>(10 * 60_000);
  private limiter = new OutboundLimiter(10, 1000);

  constructor(
    private readonly appName = 'AURIS',
    private readonly base = 'https://api.audius.co/v1',
    private readonly fetcher: typeof fetchJson = fetchJson,
  ) {}

  owns(id: string) {
    return id.startsWith(P + ':');
  }

  private url(path: string, params: Record<string, string | number> = {}) {
    const qs = new URLSearchParams({ app_name: this.appName, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    return `${this.base}${path}?${qs}`;
  }
  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = this.url(path, params);
    return this.cache.wrap(url, async () => {
      await this.limiter.take();
      try {
        const r = await this.fetcher<{ data: T }>(url, { timeoutMs: 10_000 });
        return r.data;
      } catch (e) {
        if (e instanceof UpstreamError && e.status === 404) throw e;
        throw new UpstreamError(`Audius: ${(e as Error).message}`, (e as UpstreamError).status);
      }
    }) as Promise<T>;
  }

  private art(a?: Record<string, string> | null) {
    return a?.['480x480'] ?? a?.['1000x1000'] ?? a?.['150x150'];
  }

  toTrack(t: AuTrack): Track {
    const genre = t.genre ? canonicalGenre(t.genre.split(',')[0]!.trim()) : undefined;
    const extraTags = (t.tags ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 6);
    return {
      id: `${P}:${t.id}`,
      provider: 'audius',
      title: t.title,
      artist: { id: `${P}:${t.user.id}`, name: t.user.name },
      durationSec: t.duration,
      coverUrl: this.art(t.artwork),
      genres: genre ? [genre] : [],
      tags: [...new Set([...(t.mood ? (MOOD_TAGS[t.mood] ?? []) : []), ...extraTags])],
      popularity: Math.min(1, Math.log10(1 + (t.play_count ?? 0)) / 6),
      isrc: t.isrc ?? undefined,
      playback: audiusPlayable(t)
        ? { kind: 'full', playableSec: t.duration, qualities: [{ tier: 'standard', codec: 'mp3', lossless: false }] }
        : { kind: 'none', playableSec: 0, qualities: [], note: 'Артист ограничил прослушивание этого трека' },
      license: { name: 'Audius — права у артиста', attribution: t.user.name, sourceUrl: t.permalink ? `${SITE}${t.permalink}` : SITE },
      downloadable: false,
      downloadNote: 'Audius не разрешает пересылать файлы треков — их можно только слушать',
    };
  }
  private list(tracks: AuTrack[] | undefined, limit: number) {
    return (tracks ?? []).filter(audiusPlayable).slice(0, limit).map((t) => this.toTrack(t));
  }
  private toArtist(u: AuUser): Artist {
    return { id: `${P}:${u.id}`, provider: 'audius', name: u.name, pictureUrl: this.art(u.profile_picture), genres: [], fans: u.follower_count };
  }
  private toAlbum(p: AuPlaylist, tracks?: Track[]): Album {
    return {
      id: `${P}:${p.id}`,
      provider: 'audius',
      title: p.playlist_name,
      artist: { id: `${P}:${p.user.id}`, name: p.user.name },
      coverUrl: this.art(p.artwork),
      releaseDate: p.release_date ?? undefined,
      trackCount: tracks?.length ?? p.track_count,
      tracks,
    };
  }

  async search(query: string, opts: { type: 'all' | 'track' | 'artist' | 'album'; limit: number }): Promise<SearchResult> {
    const want = (k: string) => opts.type === 'all' || opts.type === k;
    const [tracks, users, lists] = await Promise.all([
      want('track') ? this.get<AuTrack[]>('/tracks/search', { query, limit: Math.min(50, opts.limit * 2) }).catch(() => []) : [],
      want('artist') ? this.get<AuUser[]>('/users/search', { query, limit: Math.min(10, opts.limit) }).catch(() => []) : [],
      want('album') ? this.get<AuPlaylist[]>('/playlists/search', { query, limit: Math.min(10, opts.limit) }).catch(() => []) : [],
    ]);
    return { tracks: this.list(tracks, opts.limit), artists: users.map((u) => this.toArtist(u)), albums: lists.map((p) => this.toAlbum(p)) };
  }

  async getTrack(id: string) {
    try {
      return this.toTrack(await this.get<AuTrack>(`/tracks/${encodeURIComponent(stripPrefix(id, P))}`));
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404) return null;
      throw e;
    }
  }
  async getAlbum(id: string) {
    const pid = encodeURIComponent(stripPrefix(id, P));
    const [p] = await this.get<AuPlaylist[]>(`/playlists/${pid}`).catch(() => [] as AuPlaylist[]);
    if (!p) return null;
    const tracks = await this.get<AuTrack[]>(`/playlists/${pid}/tracks`).catch(() => []);
    return this.toAlbum(p, this.list(tracks, 100));
  }
  async getArtist(id: string) {
    const u = await this.get<AuUser>(`/users/${encodeURIComponent(stripPrefix(id, P))}`).catch(() => null);
    return u ? this.toArtist(u) : null;
  }
  async getArtistTopTracks(id: string, limit: number) {
    const t = await this.get<AuTrack[]>(`/users/${encodeURIComponent(stripPrefix(id, P))}/tracks`, { sort_method: 'plays', limit: Math.min(50, limit * 2) });
    return this.list(t, limit);
  }
  async getRelatedArtists(id: string, limit: number) {
    const u = await this.get<AuUser[]>(`/users/${encodeURIComponent(stripPrefix(id, P))}/related`, { limit }).catch(() => []);
    return u.slice(0, limit).map((x) => this.toArtist(x));
  }
  async getChart(limit: number) {
    return this.list(await this.get<AuTrack[]>('/tracks/trending', { time: 'week', limit: Math.min(100, limit * 2) }), limit);
  }
  async getChartArtists(limit: number) {
    const t = await this.get<AuTrack[]>('/tracks/trending', { time: 'week', limit: 100 });
    const seen = new Map<string, Artist>();
    for (const x of t.filter(audiusPlayable)) if (!seen.has(x.user.id)) seen.set(x.user.id, this.toArtist(x.user));
    return [...seen.values()].slice(0, limit);
  }
  async getGenres(): Promise<Genre[]> {
    return Object.keys(GENRE_TO_AUDIUS).map((g) => ({ id: g, name: GENRE_NAMES_RU[g] ?? GENRE_TO_AUDIUS[g]! }));
  }
  async getGenreTracks(genre: string, limit: number) {
    const g = GENRE_TO_AUDIUS[genre];
    if (!g) return [];
    return this.list(await this.get<AuTrack[]>('/tracks/trending', { genre: g, time: 'month', limit: Math.min(100, limit * 2) }), limit);
  }
  async getTagTracks(tags: string[], limit: number) {
    const t = await this.get<AuTrack[]>('/tracks/trending', { time: 'month', limit: 100 });
    return this.list(t, 100).filter((x) => x.tags.some((tag) => tags.includes(tag))).slice(0, limit);
  }
  async getEditorial() {
    // Trending playlists curated by the network; first with at least 3 playable tracks.
    const lists = await this.get<AuPlaylist[]>('/playlists/trending', { time: 'week', limit: 5 }).catch(() => []);
    for (const p of lists) {
      const a = await this.getAlbum(`${P}:${p.id}`);
      if (a && (a.tracks?.length ?? 0) >= 3) return a;
    }
    return null;
  }

  async getStream(id: string, _tier: QualityTier): Promise<StreamSource | null> {
    void _tier;
    const t = await this.get<AuTrack>(`/tracks/${encodeURIComponent(stripPrefix(id, P))}`).catch(() => null);
    if (!t || !audiusPlayable(t)) return null;
    // Redirects to a content node serving MP3 with byte ranges; our proxy follows it.
    return { url: this.url(`/tracks/${encodeURIComponent(t.id)}/stream`), mime: 'audio/mpeg', kind: 'full', playableSec: t.duration, tier: 'standard' };
  }

  async getDownload(_id: string): Promise<DownloadDecision> {
    void _id;
    return { allowed: false, code: 'rights_unknown', reason: 'Audius не разрешает пересылать файлы треков — их можно только слушать' };
  }

  async match(hint: RecognizedHint) {
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const r = await this.get<AuTrack[]>('/tracks/search', { query: `${hint.artist} ${hint.title}`, limit: 10 }).catch(() => []);
    const hit = r.filter(audiusPlayable).find((t) => norm(t.title).includes(norm(hint.title)) && norm(t.user.name) === norm(hint.artist));
    return hit ? this.toTrack(hit) : null;
  }
}
