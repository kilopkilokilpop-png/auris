import type { Album, Artist, AudioQuality, Genre, QualityTier, Track } from '@auris/shared';
import { classifyQuality, pickVariant } from '@auris/shared';
import { fetchJson, TtlCache, UpstreamError } from '../../lib/http.js';
import { stripPrefix, type DownloadDecision, type MusicProvider, type ProviderInfo, type RecognizedHint, type SearchResult, type StreamSource } from './MusicProvider.js';

/**
 * Stub adapter for a future B2B licensed catalogue (Tuned Global, 7digital or similar).
 *
 * It speaks the neutral REST contract documented in docs/licensed-provider.md. Integrating a real
 * vendor = a small translation service (or rewrite of `request`) that exposes that contract.
 * Nothing in UI, recommendations or bot changes.
 *
 * Downloads are enabled ONLY when LICENSED_DOWNLOADS_CONTRACTED=true (contract explicitly grants
 * download + sending to Telegram) AND the vendor marks the individual track `rights.download = true`.
 */
const P = 'licensed';

export interface LxVariant { codec: 'mp3' | 'aac' | 'flac'; bitrateKbps?: number; bitDepth?: number; sampleRateHz?: number; lossless: boolean }
export interface LxTrack {
  id: string;
  title: string;
  artist: { id: string; name: string };
  album?: { id: string; title: string; coverUrl?: string };
  durationSec: number;
  isrc?: string;
  genres?: string[];
  moods?: string[];
  popularity?: number;
  variants: LxVariant[];
  /** Rights granted for this track in this territory. */
  rights: { stream: boolean; preview: boolean; download: boolean; fileIdCache?: boolean };
  previewSec?: number;
  licenseLabel?: string;
}

export class LicensedProvider implements MusicProvider {
  readonly info: ProviderInfo;
  private cache = new TtlCache<unknown>(5 * 60_000);

  constructor(
    private readonly cfg: { url?: string; key?: string; downloadsContracted: boolean; cacheFileId: boolean },
    private readonly fetcher: typeof fetchJson = fetchJson,
  ) {
    this.info = {
      id: 'licensed',
      name: 'Лицензионный каталог',
      fullStreams: true,
      previewsOnly: false,
      downloads: cfg.downloadsContracted,
      notice: cfg.url ? 'Лицензионный каталог партнёра.' : 'Лицензионный каталог ещё не подключён.',
      maxTier: 'hires',
    };
  }

  owns(id: string) {
    return id.startsWith(P + ':');
  }

  private async request<T>(path: string): Promise<T> {
    if (!this.cfg.url || !this.cfg.key) throw new UpstreamError('Licensed provider is not configured', 503);
    return this.cache.wrap(path, () =>
      this.fetcher<T>(this.cfg.url!.replace(/\/$/, '') + path, { headers: { authorization: `Bearer ${this.cfg.key}` } }),
    ) as Promise<T>;
  }

  toTrack(t: LxTrack): Track {
    const qualities: AudioQuality[] = t.variants.map((v) => ({ ...v, tier: classifyQuality(v) }));
    const playback: Track['playback'] = t.rights.stream
      ? { kind: 'full', playableSec: t.durationSec, qualities }
      : t.rights.preview
        ? { kind: 'preview', playableSec: t.previewSec ?? 30, qualities: qualities.filter((q) => !q.lossless).slice(0, 1), note: 'Правообладатель разрешил только превью' }
        : { kind: 'none', playableSec: 0, qualities: [], note: 'Нет прав на воспроизведение' };
    const canDl = this.cfg.downloadsContracted && t.rights.download === true;
    return {
      id: `${P}:${t.id}`,
      provider: 'licensed',
      title: t.title,
      artist: { id: `${P}:${t.artist.id}`, name: t.artist.name },
      album: t.album ? { id: `${P}:${t.album.id}`, title: t.album.title } : undefined,
      durationSec: t.durationSec,
      coverUrl: t.album?.coverUrl,
      genres: t.genres ?? [],
      tags: t.moods ?? [],
      popularity: t.popularity ?? 0,
      isrc: t.isrc,
      playback,
      license: { name: t.licenseLabel ?? 'Лицензия партнёра' },
      downloadable: canDl,
      downloadNote: canDl ? undefined : 'Скачивание не предусмотрено договором',
    };
  }

  async search(query: string, opts: { type: 'all' | 'track' | 'artist' | 'album'; limit: number }): Promise<SearchResult> {
    const r = await this.request<{ tracks: LxTrack[]; artists: { id: string; name: string; imageUrl?: string }[]; albums: { id: string; title: string; artist: { id: string; name: string }; coverUrl?: string }[] }>(
      `/v1/search?q=${encodeURIComponent(query)}&type=${opts.type}&limit=${opts.limit}`,
    );
    return {
      tracks: r.tracks.map((t) => this.toTrack(t)),
      artists: r.artists.map((a): Artist => ({ id: `${P}:${a.id}`, provider: 'licensed', name: a.name, pictureUrl: a.imageUrl, genres: [] })),
      albums: r.albums.map((a): Album => ({ id: `${P}:${a.id}`, provider: 'licensed', title: a.title, artist: { id: `${P}:${a.artist.id}`, name: a.artist.name }, coverUrl: a.coverUrl })),
    };
  }
  async getTrack(id: string) {
    return this.toTrack(await this.request<LxTrack>(`/v1/tracks/${encodeURIComponent(stripPrefix(id, P))}`));
  }
  async getAlbum(id: string) {
    const a = await this.request<{ id: string; title: string; artist: { id: string; name: string }; coverUrl?: string; tracks: LxTrack[] }>(`/v1/albums/${encodeURIComponent(stripPrefix(id, P))}`);
    return { id: `${P}:${a.id}`, provider: 'licensed' as const, title: a.title, artist: { id: `${P}:${a.artist.id}`, name: a.artist.name }, coverUrl: a.coverUrl, tracks: a.tracks.map((t) => this.toTrack(t)) };
  }
  async getArtist(id: string) {
    const a = await this.request<{ id: string; name: string; imageUrl?: string; genres?: string[] }>(`/v1/artists/${encodeURIComponent(stripPrefix(id, P))}`);
    return { id: `${P}:${a.id}`, provider: 'licensed' as const, name: a.name, pictureUrl: a.imageUrl, genres: a.genres ?? [] };
  }
  async getArtistTopTracks(id: string, limit: number) {
    return (await this.request<LxTrack[]>(`/v1/artists/${encodeURIComponent(stripPrefix(id, P))}/top?limit=${limit}`)).map((t) => this.toTrack(t));
  }
  async getRelatedArtists(id: string, limit: number) {
    const r = await this.request<{ id: string; name: string; imageUrl?: string }[]>(`/v1/artists/${encodeURIComponent(stripPrefix(id, P))}/related?limit=${limit}`);
    return r.map((a): Artist => ({ id: `${P}:${a.id}`, provider: 'licensed', name: a.name, pictureUrl: a.imageUrl, genres: [] }));
  }
  async getChart(limit: number) {
    return (await this.request<LxTrack[]>(`/v1/charts/tracks?limit=${limit}`)).map((t) => this.toTrack(t));
  }
  async getChartArtists(limit: number) {
    const r = await this.request<{ id: string; name: string; imageUrl?: string }[]>(`/v1/charts/artists?limit=${limit}`);
    return r.map((a): Artist => ({ id: `${P}:${a.id}`, provider: 'licensed', name: a.name, pictureUrl: a.imageUrl, genres: [] }));
  }
  async getGenres(): Promise<Genre[]> {
    return this.request<Genre[]>('/v1/genres');
  }
  async getGenreTracks(genre: string, limit: number) {
    return (await this.request<LxTrack[]>(`/v1/genres/${encodeURIComponent(genre)}/tracks?limit=${limit}`)).map((t) => this.toTrack(t));
  }
  async getEditorial() {
    return null;
  }
  async getStream(id: string, tier: QualityTier): Promise<StreamSource | null> {
    const track = await this.getTrack(id);
    if (track.playback.kind === 'none') return null;
    const v = pickVariant(track.playback.qualities, tier);
    if (!v) return null;
    const r = await this.request<{ url: string; mime: string }>(`/v1/tracks/${encodeURIComponent(stripPrefix(id, P))}/stream?codec=${v.codec}&tier=${v.tier}`);
    return { url: r.url, mime: r.mime, kind: track.playback.kind, playableSec: track.playback.playableSec, tier: v.tier };
  }
  async getDownload(id: string): Promise<DownloadDecision> {
    if (!this.cfg.downloadsContracted) {
      return { allowed: false, code: 'not_contracted', reason: 'Договор с правообладателем не разрешает скачивание' };
    }
    let t: LxTrack;
    try {
      t = await this.request<LxTrack>(`/v1/tracks/${encodeURIComponent(stripPrefix(id, P))}`);
    } catch {
      return { allowed: false, code: 'rights_unknown', reason: 'Не удалось подтвердить права на трек' };
    }
    if (t.rights.download !== true) return { allowed: false, code: 'license_forbids', reason: 'Лицензия трека не разрешает скачивание' };
    const f = await this.request<{ url: string; mime: 'audio/mpeg' | 'audio/mp4'; sizeBytes?: number }>(`/v1/tracks/${encodeURIComponent(t.id)}/download`);
    return {
      allowed: true,
      source: { url: f.url, mime: f.mime, sizeBytes: f.sizeBytes, filename: `${t.artist.name} — ${t.title}.${f.mime === 'audio/mp4' ? 'm4a' : 'mp3'}` },
      cacheFileId: this.cfg.cacheFileId && t.rights.fileIdCache === true,
      attribution: `${t.artist.name} — ${t.title}`,
    };
  }
  async match(hint: RecognizedHint) {
    if (!hint.isrc) return null;
    const r = await this.request<LxTrack[]>(`/v1/tracks?isrc=${encodeURIComponent(hint.isrc)}`).catch(() => []);
    return r[0] ? this.toTrack(r[0]) : null;
  }
}
