/**
 * Official YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference).
 * Loaded from youtube.com on demand — no wrappers, no hidden or audio-only players.
 */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  loadVideoById(id: string): void;
  cueVideoById(id: string): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}
export interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      host?: string;
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(timeoutMs = 15_000): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => {
      loading = null;
      reject(new Error('YouTube недоступен'));
    }, timeoutMs);
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      clearTimeout(timer);
      resolve(window.YT!);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      loading = null;
      reject(new Error('YouTube недоступен'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Human text for IFrame API error codes. */
export function youTubeErrorText(code: number): string {
  if (code === 100) return 'Видео удалено или скрыто автором.';
  if (code === 101 || code === 150 || code === 153) return 'Автор запретил воспроизведение этого видео вне YouTube.';
  if (code === 5) return 'Это видео нельзя воспроизвести в этом приложении.';
  return 'Не удалось загрузить видео YouTube.';
}

export const YT_MIN_SIDE = 200;
