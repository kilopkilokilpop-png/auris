import type { Album, Artist, AudioQuality, Genre, QualityTier, Track } from '@auris/shared';
import { pickVariant } from '@auris/shared';
import {
  MOCK_ALBUMS,
  MOCK_ARTISTS,
  MOCK_DURATION_SEC,
  MOCK_GENRES,
  MOCK_TRACKS,
  type MockAlbum,
  type MockArtist,
  type MockTrack,
} from './mock-catalog.js';
import { MockMedia, type MockVariant } from './mock-media.js';
import { stripPrefix, type MusicProvider, type ProviderInfo, type RecognizedHint, type SearchResult, type StreamSource } from './MusicProvider.js';

const P = 'mock';
const MP3: AudioQuality = { tier: 'standard', codec: 'mp3', bitrateKbps: 192, lossless: false };
const HIFI: AudioQuality = { tier: 'hifi', codec: 'flac', bitDepth: 16, sampleRateHz: 44_100, lossless: true };
const HIRES: AudioQuality = { tier: 'hires', codec: 'flac', bitDepth: 24, sampleRateHz: 96_000, lossless: true };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();

export class MockProvider implements MusicProvider {
  readonly info: ProviderInfo = {
    id: 'mock',
    name: 'Демо-каталог AURIS',
    fullStreams: true,
    previewsOnly: false,
    notice: 'Демо-каталог: оригинальные синтезированные треки AURIS по 45 секунд, лицензия CC0.',
    maxTier: 'hires',
    tiers: { standard: 'MP3 192 кбит/с', hifi: 'FLAC 16 бит / 44,1 кГц', hires: 'до 24 бит / 96 кГц' },
  };

  constructor(private readonly media: MockMedia) {}

  owns(id: string) {
    return id.startsWith(P + ':');
  }

  private artistOf(id: string): MockArtist {
    return MOCK_ARTISTS.find((a) => a.id === id)!;
  }
  private seed(id: string): number {
    return [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  }
  private cover(id: string) {
    return `/api/media/cover/${P}:${id}`;
  }

  toTrack(t: MockTrack): Track {
    const a = this.artistOf(t.artist);
    const al = MOCK_ALBUMS.find((x) => x.id === t.album);
    const qualities = [MP3, ...(t.variants.includes('hifi') ? [HIFI] : []), ...(t.variants.includes('hires') ? [HIRES] : [])];
    return {
      id: `${P}:${t.id}`,
      provider: 'mock',
      title: t.title,
      artist: { id: `${P}:${a.id}`, name: a.name },
      album: al ? { id: `${P}:${al.id}`, title: al.title } : undefined,
      durationSec: MOCK_DURATION_SEC,
      coverUrl: this.cover(t.album),
      genres: t.genres,
      tags: t.tags,
      popularity: t.popularity,
      playback: { kind: 'full', playableSec: MOCK_DURATION_SEC, qualities },
      license: { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: `${a.name} (демо AURIS)` },
    };
  }
  private toArtist(a: MockArtist): Artist {
    return {
      id: `${P}:${a.id}`,
      provider: 'mock',
      name: a.name,
      genres: a.genres,
      pictureUrl: this.cover(a.id),
      fans: Math.round(1000 + this.seed(a.id) * 97),
    };
  }
  private toAlbum(al: MockAlbum, withTracks = false): Album {
    const a = this.artistOf(al.artist);
    const tracks = MOCK_TRACKS.filter((t) => t.album === al.id);
    return {
      id: `${P}:${al.id}`,
      provider: 'mock',
      title: al.title,
      artist: { id: `${P}:${a.id}`, name: a.name },
      coverUrl: this.cover(al.id),
      releaseDate: `${al.year}-01-01`,
      trackCount: tracks.length,
      tracks: withTracks ? tracks.map((t) => this.toTrack(t)) : undefined,
    };
  }

  async search(query: string, opts: { type: 'all' | 'track' | 'artist' | 'album'; limit: number }): Promise<SearchResult> {
    const q = norm(query);
    const hit = (s: string) => norm(s).includes(q);
    const tracks = opts.type === 'all' || opts.type === 'track'
      ? MOCK_TRACKS.filter((t) => hit(t.title) || hit(this.artistOf(t.artist).name) || t.genres.some(hit) || t.tags.some(hit))
      : [];
    const artists = opts.type === 'all' || opts.type === 'artist' ? MOCK_ARTISTS.filter((a) => hit(a.name)) : [];
    const albums = opts.type === 'all' || opts.type === 'album' ? MOCK_ALBUMS.filter((a) => hit(a.title) || hit(this.artistOf(a.artist).name)) : [];
    return {
      tracks: tracks.sort((a, b) => b.popularity - a.popularity).slice(0, opts.limit).map((t) => this.toTrack(t)),
      artists: artists.slice(0, opts.limit).map((a) => this.toArtist(a)),
      albums: albums.slice(0, opts.limit).map((a) => this.toAlbum(a)),
    };
  }

  async getTrack(id: string) {
    const t = MOCK_TRACKS.find((x) => x.id === stripPrefix(id, P));
    return t ? this.toTrack(t) : null;
  }
  async getAlbum(id: string) {
    const a = MOCK_ALBUMS.find((x) => x.id === stripPrefix(id, P));
    return a ? this.toAlbum(a, true) : null;
  }
  async getArtist(id: string) {
    const a = MOCK_ARTISTS.find((x) => x.id === stripPrefix(id, P));
    return a ? this.toArtist(a) : null;
  }
  async getArtistTopTracks(id: string, limit: number) {
    const aid = stripPrefix(id, P);
    return MOCK_TRACKS.filter((t) => t.artist === aid).sort((a, b) => b.popularity - a.popularity).slice(0, limit).map((t) => this.toTrack(t));
  }
  async getRelatedArtists(id: string, limit: number) {
    const a = MOCK_ARTISTS.find((x) => x.id === stripPrefix(id, P));
    return (a?.related ?? []).slice(0, limit).map((r) => this.toArtist(this.artistOf(r)));
  }
  async getChart(limit: number) {
    return [...MOCK_TRACKS].sort((a, b) => b.popularity - a.popularity).slice(0, limit).map((t) => this.toTrack(t));
  }
  async getChartArtists(limit: number) {
    const score = (a: MockArtist) => Math.max(...MOCK_TRACKS.filter((t) => t.artist === a.id).map((t) => t.popularity));
    return [...MOCK_ARTISTS].sort((a, b) => score(b) - score(a)).slice(0, limit).map((a) => this.toArtist(a));
  }
  async getGenres(): Promise<Genre[]> {
    return MOCK_GENRES;
  }
  async getGenreTracks(genre: string, limit: number) {
    return MOCK_TRACKS.filter((t) => t.genres.includes(genre)).slice(0, limit).map((t) => this.toTrack(t));
  }
  async getTagTracks(tags: string[], limit: number) {
    return MOCK_TRACKS.filter((t) => t.tags.some((x) => tags.includes(x))).slice(0, limit).map((t) => this.toTrack(t));
  }
  async getEditorial() {
    return this.toAlbum(MOCK_ALBUMS[0]!, true);
  }

  async getStream(id: string, tier: QualityTier): Promise<StreamSource | null> {
    const t = MOCK_TRACKS.find((x) => x.id === stripPrefix(id, P));
    if (!t) return null;
    const v = pickVariant(this.toTrack(t).playback.qualities, tier)!;
    const variant: MockVariant = v.tier === 'hires' ? 'hires' : v.tier === 'hifi' ? 'hifi' : 'mp3';
    const filePath = await this.media.ensureAudio(t, variant);
    return { url: '', filePath, mime: variant === 'mp3' ? 'audio/mpeg' : 'audio/flac', kind: 'full', playableSec: MOCK_DURATION_SEC, tier: v.tier };
  }

  async match(hint: RecognizedHint) {
    const q = norm(hint.title);
    const t = MOCK_TRACKS.find((x) => norm(x.title) === q && norm(this.artistOf(x.artist).name) === norm(hint.artist));
    return t ? this.toTrack(t) : null;
  }

  async coverFile(id: string, format: 'svg' | 'jpg' = 'jpg'): Promise<string | null> {
    const raw = stripPrefix(id, P);
    if (![...MOCK_ALBUMS.map((a) => a.id), ...MOCK_ARTISTS.map((a) => a.id)].includes(raw)) return null;
    return this.media.ensureCover(raw, this.seed(raw), format);
  }

  /** Pre-render audio in background so the first tap plays instantly. */
  async warmup(): Promise<void> {
    for (const t of MOCK_TRACKS) {
      await this.media.ensureAudio(t, 'mp3');
    }
  }
}
