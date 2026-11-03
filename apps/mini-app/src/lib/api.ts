import type {
  Album,
  ApiError,
  Collection,
  PlaylistDetail,
  Artist,
  CatalogCapabilities,
  ErrorCode,
  EventKind,
  Genre,
  Mood,
  Playlist,
  QualityTier,
  Recognition,
  SearchResponse,
  StreamInfo,
  Track,
  UserProfile,
  WaveItem,
  WaveMode,
} from '@auris/shared';
import { tg } from './telegram';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly status: number,
    readonly botLink?: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        authorization: `tma ${tg.initData}`,
        ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      },
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiFailure('NETWORK', 'Нет соединения. Проверьте интернет и попробуйте снова.', 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
  if (!res.ok) {
    const e = data.error;
    throw new ApiFailure(e?.code ?? 'INTERNAL', e?.message ?? `Ошибка ${res.status}`, res.status, e?.botLink, e?.retryAfterSec);
  }
  return data;
}

export const api = {
  me: () => request<UserProfile>('GET', '/api/me'),
  settings: (s: Partial<{ quality: QualityTier; waveMood: Mood; waveMode: WaveMode }>) => request<UserProfile>('PATCH', '/api/me/settings', s),
  resetRecommendations: () => request<{ ok: true }>('POST', '/api/me/reset-recommendations'),
  deleteMe: () => request<{ ok: true }>('DELETE', '/api/me'),

  home: () => request<{ editorial: Album | null; recent: Track[]; capabilities: CatalogCapabilities }>('GET', '/api/home'),
  publicConfig: () => request<{ botUsername: string | null }>('GET', '/api/public-config'),
  capabilities: () => request<CatalogCapabilities>('GET', '/api/catalog/capabilities'),
  search: (q: string) => request<SearchResponse>('GET', `/api/search?q=${encodeURIComponent(q)}`),
  recentSearches: () => request<{ queries: string[] }>('GET', '/api/search/recent'),
  clearRecentSearches: () => request<{ ok: true }>('DELETE', '/api/search/recent'),
  charts: () => request<{ tracks: Track[]; artists: Artist[] }>('GET', '/api/charts'),
  album: (id: string) => request<Album>('GET', `/api/albums/${encodeURIComponent(id)}`),
  artist: (id: string) => request<{ artist: Artist; tracks: Track[] }>('GET', `/api/artists/${encodeURIComponent(id)}`),
  track: (id: string) => request<Track>('GET', `/api/tracks/${encodeURIComponent(id)}`),

  streamUrl: (id: string, quality: QualityTier) => request<StreamInfo>('GET', `/api/stream-url/${encodeURIComponent(id)}?quality=${quality}`),
  event: (trackId: string, kind: EventKind, extra: { positionSec?: number; listenedSec?: number; context?: string } = {}) =>
    request<{ ok: true }>('POST', '/api/events', { trackId, kind, ...extra }).catch(() => undefined),

  likedIds: () => request<{ ids: string[] }>('GET', '/api/likes/ids'),
  liked: () => request<{ tracks: Track[] }>('GET', '/api/likes'),
  like: (id: string) => request<{ ok: true }>('POST', `/api/likes/${encodeURIComponent(id)}`),
  unlike: (id: string) => request<{ ok: true }>('DELETE', `/api/likes/${encodeURIComponent(id)}`),
  dislike: (id: string) => request<{ ok: true }>('POST', `/api/dislikes/${encodeURIComponent(id)}`),
  likedAlbums: () => request<{ albums: Album[] }>('GET', '/api/albums/liked'),
  likeAlbum: (id: string) => request<{ ok: true }>('POST', `/api/albums/${encodeURIComponent(id)}/like`),
  unlikeAlbum: (id: string) => request<{ ok: true }>('DELETE', `/api/albums/${encodeURIComponent(id)}/like`),

  playlists: () => request<{ playlists: Playlist[] }>('GET', '/api/playlists'),
  playlist: (id: string) => request<PlaylistDetail>('GET', `/api/playlists/${id}`),
  createPlaylist: (title: string) => request<{ id: string }>('POST', '/api/playlists', { title }),
  addToPlaylist: (pid: string, trackId: string) => request<{ ok: true }>('POST', `/api/playlists/${pid}/tracks`, { trackId }),
  removeFromPlaylist: (pid: string, trackId: string) => request<{ ok: true }>('DELETE', `/api/playlists/${pid}/tracks/${encodeURIComponent(trackId)}`),
  invite: (pid: string) => request<{ token: string; link: string }>('POST', `/api/playlists/${pid}/invite`),
  invitePreview: (token: string) => request<{ title: string; owner: string; trackCount: number; memberCount: number }>('GET', `/api/playlists/invite/${encodeURIComponent(token)}`),
  joinPlaylist: (token: string) => request<{ id: string; title: string }>('POST', '/api/playlists/join', { token }),
  deletePlaylist: (pid: string) => request<{ ok: true; deleted: boolean }>('DELETE', `/api/playlists/${pid}`),
  collections: () => request<{ collections: Collection[] }>('GET', '/api/collections'),
  collection: (id: string, page = 0) =>
    request<{ id: string; title: string; subtitle: string; tracks: Track[]; page: number; hasMore: boolean }>('GET', `/api/collections/${encodeURIComponent(id)}?page=${page}`),

  waveNext: (body: { mood: Mood; mode: WaveMode; exclude: string[]; recentArtists: string[]; count: number }) =>
    request<{ items: WaveItem[] }>('POST', '/api/wave/next', body),
  onboarding: () => request<{ genres: Genre[]; artists: Artist[] }>('GET', '/api/onboarding'),
  submitOnboarding: (genres: string[], artists: string[]) => request<UserProfile>('POST', '/api/onboarding', { genres, artists }),

  recognize: (audio: Blob, filename: string) => {
    const f = new FormData();
    f.set('audio', audio, filename);
    return request<Recognition>('POST', '/api/recognize', f);
  },
  recognitions: () => request<{ items: Recognition[] }>('GET', '/api/recognitions'),

  download: (trackId: string) => request<{ status: 'sent'; cached: boolean }>('POST', '/api/downloads', { trackId }),
};
