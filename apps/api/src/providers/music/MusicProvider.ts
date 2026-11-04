import type { Album, Artist, Genre, ProviderId, QualityTier, Track } from '@auris/shared';

/** Where the server may fetch the audio bytes from for a given track/quality. */
export interface StreamSource {
  /** Upstream URL. NEVER sent to the client — the API proxies it (may contain credentials). */
  url: string;
  /** Local file instead of a URL (MockProvider). */
  filePath?: string;
  mime: string;
  kind: 'full' | 'preview';
  playableSec: number;
  tier: QualityTier;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  fullStreams: boolean;
  previewsOnly: boolean;
  /**
   * Results must never be merged with other sources (YouTube Developer Policies III.C.5):
   * the composite leaves this adapter out of merged lists; callers ask it explicitly.
   */
  separateResults?: boolean;
  /** Shown to users verbatim: what they get from this source. */
  notice: string;
  /** Best real tier the catalogue can deliver, with human summary. */
  maxTier: QualityTier;
  /** Human summary of the best real variant per tier, e.g. { hires: "до 24 бит / 96 кГц" }. */
  tiers?: Partial<Record<QualityTier, string>>;
}

export interface SearchResult {
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
}

export interface RecognizedHint {
  title: string;
  artist: string;
  isrc?: string;
  /** Provider native ids reported by the recognition service, e.g. { deezer: "3135556" } */
  externalIds?: Partial<Record<ProviderId, string>>;
}

/**
 * Single seam for every music source. The UI, recommendations and the bot only talk to this.
 * Ids passed in and out are namespaced ("deezer:123"); adapters strip their own prefix.
 */
export interface MusicProvider {
  readonly info: ProviderInfo;
  /** True when `id` belongs to this adapter. */
  owns(id: string): boolean;

  search(query: string, opts: { type: 'all' | 'track' | 'artist' | 'album'; limit: number; offset?: number }): Promise<SearchResult>;
  getTrack(id: string): Promise<Track | null>;
  getAlbum(id: string): Promise<Album | null>;
  getArtist(id: string): Promise<Artist | null>;
  getArtistTopTracks(id: string, limit: number): Promise<Track[]>;
  getRelatedArtists(id: string, limit: number): Promise<Artist[]>;
  getChart(limit: number): Promise<Track[]>;
  getChartArtists(limit: number): Promise<Artist[]>;
  getGenres(): Promise<Genre[]>;
  getGenreTracks(genre: string, limit: number, offset?: number): Promise<Track[]>;
  /** Tracks matching free tags (moods), if the source supports tags. */
  getTagTracks?(tags: string[], limit: number, offset?: number): Promise<Track[]>;
  /** Tracks sung in a language (ISO 639-1, e.g. "ru"), if the source knows lyrics language. */
  getLanguageTracks?(lang: string, limit: number, offset?: number): Promise<Track[]>;
  /** "Выбор редакции" */
  getEditorial(): Promise<Album | null>;

  /** Server-side only. Returns null when the track cannot be played here. */
  getStream(id: string, tier: QualityTier): Promise<StreamSource | null>;
  /** Map a recognition result to a playable catalogue track. */
  match(hint: RecognizedHint): Promise<Track | null>;
}

export function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix + ':') ? id.slice(prefix.length + 1) : id;
}
