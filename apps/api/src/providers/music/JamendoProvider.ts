import type { Album, Artist, Genre, License, QualityTier, Track } from '@auris/shared';
import { fetchJson, OutboundLimiter, TtlCache, UpstreamError } from '../../lib/http.js';
import { canonicalGenre, GENRE_NAMES_RU } from './genres.js';
import { stripPrefix, type DownloadDecision, type MusicProvider, type ProviderInfo, type RecognizedHint, type SearchResult, type StreamSource } from './MusicProvider.js';

/**
 * Jamendo API v3 (https://developer.jamendo.com/v3.0). Full-length Creative Commons tracks.
 * Terms (devportal.jamendo.com/api_terms_of_use, read 2026-11): free for NON-COMMERCIAL use;
 * must credit artists + Jamendo with a backlink; no app "specifically designed to cache content
 * or offer offline access"; downloads only where the artist allows it — the per-track
 * `audiodownload_allowed` flag (since 2021). Commercial use requires a Jamendo licence.
 */
const P = 'jamendo';
const BASE = 'https://api.jamendo.com/v3.0';
const FEATURED = 'featured';
const GENRES = ['pop', 'rock', 'electronic', 'hiphop', 'jazz', 'indie', 'classical', 'ambient', 'chillout', 'folk', 'metal', 'lounge', 'world', 'soundtrack', 'reggae', 'blues'];

export interface JmTrack {
  id: string;
  name: string;
  duration: number;
  artist_id: string;
  artist_name: string;
  album_id?: string;
  album_name?: string;
  album_image?: string;
  image?: string;
  audio?: string;
  audiodownload?: string;
  audiodownload_allowed?: boolean;
  license_ccurl?: string;
  shareurl?: string;
  musicinfo?: { tags?: { genres?: string[]; vartags?: string[] } };
  position?: number;
  stats?: { rate_listened_total?: number; rate_downloads_total?: number; popularity_total?: number };
}
interface JmArtist { id: string; name: string; image?: string; shareurl?: string }
interface JmAlbum { id: string; name: string; artist_id: string; artist_name: string; image?: string; releasedate?: string }
interface JmResp<T> { headers: { status: string; code: number; error_message?: string }; results: T[] }

/** "https://creativecommons.org/licenses/by-nc-sa/3.0/" -> "CC BY-NC-SA 3.0" */
export function licenseFromCcUrl(url?: string): { name: string; isCreativeCommons: boolean } {
  if (!url) return { name: 'Лицензия не указана', isCreativeCommons: false };
  const m = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/([\d.]+)/i.exec(url);
  if (!m) return { name: 'Лицензия не распознана', isCreativeCommons: false };
  if (m[1] === 'publicdomain') return { name: `CC0 ${m[3]}`, isCreativeCommons: true };
  return { name: `CC ${m[2]!.toUpperCase()} ${m[3]}`, isCreativeCommons: true };
}

/**
 * Per-track download rule. Allowed only when ALL are true:
 * - artist enabled download (`audiodownload_allowed === true`) and Jamendo returned a URL;
 * - the track carries a recognised Creative Commons licence (all CC licences allow verbatim non-commercial sharing with attribution).
 * Anything missing -> deny (rights unknown).
 */
export function jamendoDownloadRule(t: Pick<JmTrack, 'audiodownload_allowed' | 'audiodownload' | 'license_ccurl'>):
  | { ok: true }
  | { ok: false; code: 'license_forbids' | 'rights_unknown'; reason: string } {
  if (t.audiodownload_allowed === false) return { ok: false, code: 'license_forbids', reason: 'Артист запретил скачивание этого трека' };
  if (t.audiodownload_allowed !== true || !t.audiodownload) return { ok: false, code: 'rights_unknown', reason: 'Jamendo не подтвердил право на скачивание' };
  if (!licenseFromCcUrl(t.license_ccurl).isCreativeCommons) return { ok: false, code: 'rights_unknown', reason: 'Лицензия трека не подтверждена' };
  return { ok: true };
}

/** Jamendo returns raw counters (no 0..1 score): log-scale listens + downloads into 0..1. */
export function jamendoPopularity(stats?: JmTrack['stats']): number {
  if (!stats) return 0;
  if (stats.popularity_total) return Math.min(1, stats.popularity_total / 100);
  const n = (stats.rate_listened_total ?? 0) + (stats.rate_downloads_total ?? 0) / 10;
  return Math.min(1, Math.log10(1 + n) / 6);
}

export class JamendoProvider implements MusicProvider {
  readonly info: ProviderInfo = {
    id: 'jamendo',
    name: 'Jamendo',
    fullStreams: true,
    previewsOnly: false,
    downloads: true,
    notice: 'Jamendo: полные треки независимых артистов по лицензиям Creative Commons. Скачивание — только если артист его разрешил.',
    maxTier: 'standard',
    tiers: { standard: 'MP3 VBR' },
  };
  private cache = new TtlCache<unknown>(10 * 60_000);
  private limiter = new OutboundLimiter(20, 1000);

  constructor(
    private readonly clientId: string,
    private readonly cacheFileId: boolean,
    private readonly fetcher: typeof fetchJson = fetchJson,
    private readonly retries = 3,
  ) {}

  owns(id: string) {
    return id.startsWith(P + ':');
  }

  /**
   * Jamendo intermittently answers a valid query with an empty result set (same request, different backend).
   * Empty answers are retried and never cached, so a hiccup does not stick for the cache TTL.
   */
  private async get<T>(path: string, params: Record<string, string | number>, cache = true): Promise<T[]> {
    const qs = new URLSearchParams({ client_id: this.clientId, format: 'json', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    const url = `${BASE}${path}/?${qs}`;
    if (cache) {
      const hit = this.cache.get(url) as T[] | undefined;
      if (hit) return hit;
    }
    let results: T[] = [];
    for (let attempt = 0; attempt < this.retries; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 250 * attempt));
      await this.limiter.take();
      const r = await this.fetcher<JmResp<T>>(url);
      if (r.headers.status !== 'success') throw new UpstreamError(`Jamendo: ${r.headers.error_message ?? r.headers.code}`);
      results = r.results;
      if (results.length) break;
    }
    if (cache && results.length) this.cache.set(url, results);
    return results;
  }

  private trackParams(extra: Record<string, string | number>) {
    // Only ONE include: combining "musicinfo stats" makes filtered queries (album_id, tags) return nothing.
    return { include: 'musicinfo', audioformat: 'mp32', audiodlformat: 'mp32', imagesize: 600, ...extra };
  }

  /** Lists ordered by popularity: rank -> 0.5..1 (Jamendo gives no score with our include). */
  private ranked(list: JmTrack[]): Track[] {
    return list.map((t, i) => ({ ...this.toTrack(t), popularity: t.stats ? jamendoPopularity(t.stats) : Math.max(0.5, 1 - i / Math.max(1, list.length) / 2) }));
  }

  toTrack(t: JmTrack): Track {
    const lic = licenseFromCcUrl(t.license_ccurl);
    const rule = jamendoDownloadRule(t);
    const license: License = {
      name: lic.name,
      url: t.license_ccurl,
      attribution: `${t.artist_name} — ${t.name}`,
      sourceUrl: t.shareurl ?? `https://www.jamendo.com/track/${t.id}`,
    };
    return {
      id: `${P}:${t.id}`,
      provider: 'jamendo',
      title: t.name,
      artist: { id: `${P}:${t.artist_id}`, name: t.artist_name },
      album: t.album_id && t.album_id !== '0' ? { id: `${P}:${t.album_id}`, title: t.album_name ?? '' } : undefined,
      durationSec: t.duration,
      coverUrl: t.album_image || t.image,
      genres: (t.musicinfo?.tags?.genres ?? []).map(canonicalGenre),
      tags: t.musicinfo?.tags?.vartags ?? [],
      popularity: t.stats ? jamendoPopularity(t.stats) : 0.4,
      playback: t.audio
        ? { kind: 'full', playableSec: t.duration, qualities: [{ tier: 'standard', codec: 'mp3', lossless: false }] }
        : { kind: 'none', playableSec: 0, qualities: [], note: 'Jamendo не отдаёт поток для этого трека' },
      license,
      downloadable: rule.ok,
      downloadNote: rule.ok ? undefined : rule.reason,
    };
  }
  private toArtist(a: JmArtist): Artist {
    return { id: `${P}:${a.id}`, provider: 'jamendo', name: a.name, pictureUrl: a.image || undefined, genres: [] };
  }
  private toAlbum(a: JmAlbum, tracks?: Track[]): Album {
    return {
      id: `${P}:${a.id}`,
      provider: 'jamendo',
      title: a.name,
      artist: { id: `${P}:${a.artist_id}`, name: a.artist_name },
      coverUrl: a.image,
      releaseDate: a.releasedate,
      trackCount: tracks?.length,
      tracks,
    };
  }

  async search(query: string, opts: { type: 'all' | 'track' | 'artist' | 'album'; limit: number }): Promise<SearchResult> {
    const want = (k: string) => opts.type === 'all' || opts.type === k;
    const [tracks, artists, albums] = await Promise.all([
      want('track') ? this.get<JmTrack>('/tracks', this.trackParams({ search: query, limit: opts.limit, order: 'relevance' })) : [],
      want('artist') ? this.get<JmArtist>('/artists', { namesearch: query, limit: Math.min(10, opts.limit) }) : [],
      want('album') ? this.get<JmAlbum>('/albums', { namesearch: query, limit: Math.min(10, opts.limit), imagesize: 600 }) : [],
    ]);
    return { tracks: tracks.map((t) => this.toTrack(t)), artists: artists.map((a) => this.toArtist(a)), albums: albums.map((a) => this.toAlbum(a)) };
  }

  private async rawTrack(id: string, fresh = false): Promise<JmTrack | null> {
    const r = await this.get<JmTrack>('/tracks', this.trackParams({ id: stripPrefix(id, P) }), !fresh);
    return r[0] ?? null;
  }
  async getTrack(id: string) {
    const t = await this.rawTrack(id);
    return t ? this.toTrack(t) : null;
  }
  async getAlbum(id: string) {
    const aid = stripPrefix(id, P);
    if (aid === FEATURED) return this.featured();
    const [a] = await this.get<JmAlbum>('/albums', { id: aid, imagesize: 600 });
    if (!a) return null;
    // The API has no "order by position" for tracks: sort by the returned position.
    const tracks = await this.get<JmTrack>('/tracks', this.trackParams({ album_id: aid, limit: 50 }));
    tracks.sort((x, y) => (x.position ?? 0) - (y.position ?? 0));
    return this.toAlbum(a, tracks.map((t) => this.toTrack(t)));
  }
  async getArtist(id: string) {
    const [a] = await this.get<JmArtist>('/artists', { id: stripPrefix(id, P) });
    return a ? this.toArtist(a) : null;
  }
  async getArtistTopTracks(id: string, limit: number) {
    return this.ranked(await this.get<JmTrack>('/tracks', this.trackParams({ artist_id: stripPrefix(id, P), limit, order: 'popularity_total' })));
  }
  async getRelatedArtists(id: string, limit: number) {
    // Jamendo has no "related artists": use artists of tracks similar by the artist's main genre.
    const top = await this.getArtistTopTracks(id, 3);
    const genre = top.flatMap((t) => t.genres)[0];
    if (!genre) return [];
    const tracks = await this.getGenreTracks(genre, 30);
    const seen = new Map<string, Artist>();
    for (const t of tracks) {
      if (t.artist.id !== id && !seen.has(t.artist.id)) {
        seen.set(t.artist.id, { id: t.artist.id, provider: 'jamendo', name: t.artist.name, genres: [genre] });
      }
    }
    return [...seen.values()].slice(0, limit);
  }
  async getChart(limit: number) {
    const week = await this.get<JmTrack>('/tracks', this.trackParams({ order: 'popularity_week', limit }));
    return this.ranked(week.length ? week : await this.get<JmTrack>('/tracks', this.trackParams({ order: 'popularity_total', limit })));
  }
  async getChartArtists(limit: number) {
    return (await this.get<JmArtist>('/artists', { order: 'popularity_week', limit })).map((a) => this.toArtist(a));
  }
  async getGenres(): Promise<Genre[]> {
    return GENRES.map((g) => ({ id: g, name: GENRE_NAMES_RU[g] ?? g }));
  }
  async getGenreTracks(genre: string, limit: number) {
    // Weekly/monthly rankings combined with a tag filter come back empty: use the all-time ranking.
    return this.ranked(await this.get<JmTrack>('/tracks', this.trackParams({ tags: genre, order: 'popularity_total', limit })));
  }
  async getTagTracks(tags: string[], limit: number) {
    return this.ranked(await this.get<JmTrack>('/tracks', this.trackParams({ fuzzytags: tags.join('+'), order: 'popularity_total', limit })));
  }
  /**
   * "Выбор редакции" = Jamendo's own editorial picks (`featured=1`), exposed as a virtual album
   * `jamendo:featured`. Jamendo's top "albums" are almost all singles, so they make a poor showcase.
   */
  private async featured(): Promise<Album | null> {
    const tracks = this.ranked(await this.get<JmTrack>('/tracks', this.trackParams({ featured: 1, order: 'popularity_week', limit: 20 })));
    if (!tracks.length) return null;
    return {
      id: `${P}:${FEATURED}`,
      provider: 'jamendo',
      title: 'Выбор редакции Jamendo',
      artist: { id: `${P}:${FEATURED}`, name: 'Разные артисты' },
      coverUrl: tracks[0]!.coverUrl,
      trackCount: tracks.length,
      tracks,
    };
  }

  async getEditorial() {
    return this.featured();
  }

  async getStream(id: string, _tier: QualityTier): Promise<StreamSource | null> {
    void _tier;
    const t = await this.rawTrack(id);
    if (!t?.audio) return null;
    return { url: t.audio, mime: 'audio/mpeg', kind: 'full', playableSec: t.duration, tier: 'standard' };
  }

  async getDownload(id: string): Promise<DownloadDecision> {
    // Always fresh: the artist may have revoked download permission.
    const t = await this.rawTrack(id, true);
    if (!t) return { allowed: false, code: 'not_found', reason: 'Трек не найден на Jamendo' };
    const rule = jamendoDownloadRule(t);
    if (!rule.ok) return { allowed: false, code: rule.code, reason: rule.reason };
    const lic = licenseFromCcUrl(t.license_ccurl);
    return {
      allowed: true,
      source: { url: t.audiodownload!, mime: 'audio/mpeg', filename: `${t.artist_name} — ${t.name}.mp3` },
      cacheFileId: this.cacheFileId,
      attribution: `${t.artist_name} — ${t.name}\n${lic.name}: ${t.license_ccurl}\nИсточник: Jamendo ${t.shareurl ?? ''}`.trim(),
    };
  }

  async match(hint: RecognizedHint) {
    const r = await this.get<JmTrack>('/tracks', this.trackParams({ search: `${hint.artist} ${hint.title}`, limit: 5 })).catch(() => []);
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const hit = r.find((t) => norm(t.name) === norm(hint.title) && norm(t.artist_name) === norm(hint.artist));
    return hit ? this.toTrack(hit) : null;
  }
}
