import type { Album, Artist, Genre, QualityTier, Track } from '@auris/shared';
import { fetchJson, OutboundLimiter, TtlCache, UpstreamError } from '../../lib/http.js';
import { DEEZER_GENRES, GENRE_NAMES_RU } from './genres.js';
import { stripPrefix, type MusicProvider, type ProviderInfo, type RecognizedHint, type SearchResult, type StreamSource } from './MusicProvider.js';

/**
 * Deezer Simple API (https://developers.deezer.com/api).
 * Terms (developers.deezer.com/termsofuse, read 2026-11): free, NON-COMMERCIAL use only;
 * without a Deezer Premium login recordings are limited to 30 s; content must not be downloaded
 * and DRM must not be bypassed; users must be told that streaming is for private use.
 * => metadata, charts, covers and 30-second previews only. Downloads: always denied.
 */
const P = 'deezer';
const BASE = 'https://api.deezer.com';
const PREVIEW_SEC = 30;

interface DzArtist { id: number; name: string; picture_medium?: string; picture_big?: string; nb_fan?: number }
interface DzAlbum { id: number; title: string; cover_medium?: string; cover_big?: string; cover_xl?: string; release_date?: string; genre_id?: number; nb_tracks?: number; artist?: DzArtist; tracks?: { data: DzTrack[] }; genres?: { data: { id: number }[] } }
interface DzTrack { id: number; title: string; duration: number; rank?: number; preview?: string; readable?: boolean; isrc?: string; explicit_lyrics?: boolean; artist: DzArtist; album?: DzAlbum; link?: string }
interface DzList<T> { data: T[]; error?: { message: string; code: number } }
type DzMaybeError = { error?: { message: string; code: number } };

export class DeezerProvider implements MusicProvider {
  readonly info: ProviderInfo = {
    id: 'deezer',
    name: 'Deezer',
    fullStreams: false,
    previewsOnly: true,
    notice: 'Deezer: только 30-секундные превью и метаданные, для личного некоммерческого использования. Полные треки и скачивание недоступны.',
    maxTier: 'standard',
    tiers: { standard: 'превью MP3 128 кбит/с' },
  };
  private cache = new TtlCache<unknown>(10 * 60_000);
  private limiter = new OutboundLimiter(45, 5000);

  constructor(private readonly fetcher: typeof fetchJson = fetchJson) {}

  owns(id: string) {
    return id.startsWith(P + ':');
  }

  private async get<T>(path: string): Promise<T> {
    return this.cache.wrap(path, async () => {
      await this.limiter.take();
      const r = await this.fetcher<T & DzMaybeError>(BASE + path);
      if (r && typeof r === 'object' && 'error' in r && r.error) {
        if (r.error.code === 800) throw new UpstreamError('not found', 404);
        throw new UpstreamError(`Deezer: ${r.error.message}`);
      }
      return r;
    }) as Promise<T>;
  }

  private toTrack(t: DzTrack, genreHint?: string): Track {
    const genre = genreHint ?? (t.album?.genre_id ? DEEZER_GENRES[t.album.genre_id] : undefined);
    const canPreview = t.readable !== false && !!t.preview;
    return {
      id: `${P}:${t.id}`,
      provider: 'deezer',
      title: t.title,
      artist: { id: `${P}:${t.artist.id}`, name: t.artist.name },
      album: t.album ? { id: `${P}:${t.album.id}`, title: t.album.title } : undefined,
      durationSec: t.duration,
      coverUrl: t.album?.cover_big ?? t.album?.cover_medium,
      genres: genre ? [genre] : [],
      tags: [],
      popularity: Math.min(1, (t.rank ?? 0) / 1_000_000),
      isrc: t.isrc,
      explicit: t.explicit_lyrics,
      playback: canPreview
        ? {
            kind: 'preview',
            playableSec: Math.min(PREVIEW_SEC, t.duration || PREVIEW_SEC),
            qualities: [{ tier: 'standard', codec: 'mp3', bitrateKbps: 128, lossless: false }],
            note: 'Deezer API даёт только 30-секундное превью',
          }
        : { kind: 'none', playableSec: 0, qualities: [], note: 'Превью этого трека недоступно в вашем регионе' },
      license: { name: 'Deezer API — личное некоммерческое использование', sourceUrl: t.link ?? `https://www.deezer.com/track/${t.id}` },
    };
  }
  private toArtist(a: DzArtist): Artist {
    return { id: `${P}:${a.id}`, provider: 'deezer', name: a.name, pictureUrl: a.picture_big ?? a.picture_medium, genres: [], fans: a.nb_fan };
  }
  private toAlbum(a: DzAlbum, artist?: DzArtist): Album {
    const ar = a.artist ?? artist;
    const genre = a.genre_id ? DEEZER_GENRES[a.genre_id] : undefined;
    return {
      id: `${P}:${a.id}`,
      provider: 'deezer',
      title: a.title,
      artist: { id: `${P}:${ar?.id ?? 0}`, name: ar?.name ?? '' },
      coverUrl: a.cover_xl ?? a.cover_big ?? a.cover_medium,
      releaseDate: a.release_date,
      trackCount: a.nb_tracks,
      tracks: a.tracks?.data.map((t) => this.toTrack({ ...t, album: { ...a, tracks: undefined } }, genre)),
    };
  }

  async search(query: string, opts: { type: 'all' | 'track' | 'artist' | 'album'; limit: number }): Promise<SearchResult> {
    const q = encodeURIComponent(query);
    const want = (k: string) => opts.type === 'all' || opts.type === k;
    const [tracks, artists, albums] = await Promise.all([
      want('track') ? this.get<DzList<DzTrack>>(`/search?q=${q}&limit=${opts.limit}`) : null,
      want('artist') ? this.get<DzList<DzArtist>>(`/search/artist?q=${q}&limit=${Math.min(opts.limit, 10)}`) : null,
      want('album') ? this.get<DzList<DzAlbum>>(`/search/album?q=${q}&limit=${Math.min(opts.limit, 10)}`) : null,
    ]);
    return {
      tracks: tracks?.data.map((t) => this.toTrack(t)) ?? [],
      artists: artists?.data.map((a) => this.toArtist(a)) ?? [],
      albums: albums?.data.map((a) => this.toAlbum(a)) ?? [],
    };
  }

  async getTrack(id: string) {
    try {
      return this.toTrack(await this.get<DzTrack>(`/track/${encodeURIComponent(stripPrefix(id, P))}`));
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404) return null;
      throw e;
    }
  }
  async getAlbum(id: string) {
    try {
      return this.toAlbum(await this.get<DzAlbum>(`/album/${encodeURIComponent(stripPrefix(id, P))}`));
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404) return null;
      throw e;
    }
  }
  async getArtist(id: string) {
    try {
      return this.toArtist(await this.get<DzArtist>(`/artist/${encodeURIComponent(stripPrefix(id, P))}`));
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404) return null;
      throw e;
    }
  }
  async getArtistTopTracks(id: string, limit: number) {
    const r = await this.get<DzList<DzTrack>>(`/artist/${encodeURIComponent(stripPrefix(id, P))}/top?limit=${limit}`);
    return r.data.map((t) => this.toTrack(t));
  }
  async getRelatedArtists(id: string, limit: number) {
    const r = await this.get<DzList<DzArtist>>(`/artist/${encodeURIComponent(stripPrefix(id, P))}/related?limit=${limit}`);
    return r.data.map((a) => this.toArtist(a));
  }
  async getChart(limit: number) {
    return (await this.get<DzList<DzTrack>>(`/chart/0/tracks?limit=${limit}`)).data.map((t) => this.toTrack(t));
  }
  async getChartArtists(limit: number) {
    return (await this.get<DzList<DzArtist>>(`/chart/0/artists?limit=${limit}`)).data.map((a) => this.toArtist(a));
  }
  async getGenres(): Promise<Genre[]> {
    const r = await this.get<DzList<{ id: number; name: string }>>('/genre');
    return r.data
      .filter((g) => g.id !== 0 && DEEZER_GENRES[g.id])
      .map((g) => ({ id: DEEZER_GENRES[g.id]!, name: GENRE_NAMES_RU[DEEZER_GENRES[g.id]!] ?? g.name }));
  }
  async getGenreTracks(genre: string, limit: number) {
    const id = Object.entries(DEEZER_GENRES).find(([, v]) => v === genre)?.[0];
    if (!id) return [];
    return (await this.get<DzList<DzTrack>>(`/chart/${id}/tracks?limit=${limit}`)).data.map((t) => this.toTrack(t, genre));
  }
  async getEditorial() {
    const r = await this.get<DzList<DzAlbum>>('/editorial/0/selection?limit=1');
    const first = r.data[0];
    return first ? this.getAlbum(`${P}:${first.id}`) : null;
  }

  async getStream(id: string, _tier: QualityTier): Promise<StreamSource | null> {
    void _tier;
    // Fresh lookup: preview URLs are signed and expire.
    const t = await this.get<DzTrack>(`/track/${encodeURIComponent(stripPrefix(id, P))}`).catch(() => null);
    if (!t?.preview || t.readable === false) return null;
    return { url: t.preview, mime: 'audio/mpeg', kind: 'preview', playableSec: Math.min(PREVIEW_SEC, t.duration), tier: 'standard' };
  }

  async match(hint: RecognizedHint) {
    if (hint.externalIds?.deezer) {
      const t = await this.getTrack(`${P}:${hint.externalIds.deezer}`).catch(() => null);
      if (t) return t;
    }
    if (hint.isrc) {
      const t = await this.get<DzTrack>(`/track/isrc:${encodeURIComponent(hint.isrc)}`).catch(() => null);
      if (t?.id) return this.toTrack(t);
    }
    const q = encodeURIComponent(`artist:"${hint.artist}" track:"${hint.title}"`);
    const r = await this.get<DzList<DzTrack>>(`/search?q=${q}&limit=1`).catch(() => null);
    return r?.data[0] ? this.toTrack(r.data[0]) : null;
  }
}
