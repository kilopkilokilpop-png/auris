import {
  backButton,
  emitEvent,
  hapticFeedback,
  init as initSdk,
  isTMA,
  miniApp,
  mockTelegramEnv,
  on,
  openTelegramLink,
  retrieveLaunchParams,
  retrieveRawInitData,
  swipeBehavior,
  viewport,
} from '@telegram-apps/sdk-react';

export type LaunchMode = 'telegram' | 'browser-dev' | 'outside';

interface TgState {
  mode: LaunchMode;
  initData: string;
  botUsername: string | null;
  startParam?: string;
}

const state: TgState = { mode: 'outside', initData: '', botUsername: null };

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function applyInsets() {
  const root = document.documentElement.style;
  const s = safe(() => viewport.safeAreaInsets());
  const c = safe(() => viewport.contentSafeAreaInsets());
  // In fullscreen Telegram draws its own header over the content: content insets account for it.
  root.setProperty('--tg-safe-top', `${(s?.top ?? 0) + (c?.top ?? 0)}px`);
  root.setProperty('--tg-safe-bottom', `${(s?.bottom ?? 0) + (c?.bottom ?? 0)}px`);
  const h = safe(() => viewport.stableHeight());
  if (h) root.setProperty('--tg-viewport-stable-height', `${h}px`);
}

/**
 * Boots the official Telegram Mini Apps SDK. Outside Telegram in development we fetch initData
 * signed by the API (same algorithm as Telegram) and mock the environment, so server-side
 * signature validation is always exercised.
 */
/** Real Telegram passes launch params in the URL hash and exposes a native bridge or an iframe parent. */
function looksLikeRealTelegram(): boolean {
  const w = window as unknown as { TelegramWebviewProxy?: unknown; external?: { notify?: unknown } };
  return location.hash.includes('tgWebAppData') || !!w.TelegramWebviewProxy || typeof w.external?.notify === 'function' || window.parent !== window;
}

export async function bootTelegram(): Promise<TgState> {
  let inside = looksLikeRealTelegram() && (safe(() => isTMA()) ?? false);
  if (!inside && import.meta.env.DEV) {
    const params = new URLSearchParams(location.search);
    const q = new URLSearchParams();
    if (params.get('master')) q.set('master', params.get('master')!);
    if (params.get('uid')) q.set('id', params.get('uid')!);
    const res = await fetch(`/api/dev/init-data?${q}`).catch(() => null);
    if (res?.ok) {
      const { initData, botUsername } = (await res.json()) as { initData: string; botUsername: string | null };
      mockTelegramEnv({
        launchParams: {
          tgWebAppData: initData,
          tgWebAppVersion: '8.0',
          tgWebAppPlatform: 'tdesktop',
          tgWebAppThemeParams: { bg_color: '#0a0a0b', text_color: '#f5f5f7', secondary_bg_color: '#1c1c1f' },
        },
        // Answer the requests a real Telegram client would answer.
        onEvent(e) {
          const name = Array.isArray(e) ? e[0] : (e as { name: string }).name;
          const zero = { top: 0, bottom: 0, left: 0, right: 0 };
          if (name === 'web_app_request_viewport') emitEvent('viewport_changed', { height: innerHeight, width: innerWidth, is_expanded: true, is_state_stable: true });
          if (name === 'web_app_request_safe_area') emitEvent('safe_area_changed', zero);
          if (name === 'web_app_request_content_safe_area') emitEvent('content_safe_area_changed', zero);
          if (name === 'web_app_request_theme') emitEvent('theme_changed', { theme_params: { bg_color: '#0a0a0b', text_color: '#f5f5f7' } });
        },
      });
      state.mode = 'browser-dev';
      state.botUsername = botUsername;
      inside = true;
    }
  } else if (inside) {
    state.mode = 'telegram';
  }
  if (!inside) return state;

  // Never let an SDK bridge problem block the app: initData alone is enough to work.
  safe(() => initSdk());
  state.initData = safe(() => retrieveRawInitData()) ?? '';
  state.startParam = safe(() => retrieveLaunchParams().tgWebAppStartParam);
  if (!state.botUsername) state.botUsername = (import.meta.env.VITE_BOT_USERNAME as string | undefined) ?? null;

  safe(() => backButton.mount());
  safe(() => miniApp.mountSync());
  safe(() => miniApp.setHeaderColor('#0a0a0b'));
  safe(() => miniApp.setBackgroundColor('#0a0a0b'));
  safe(() => miniApp.setBottomBarColor('#0a0a0b'));
  // Vertical swipe closes the app in Telegram; it conflicts with scrubbing and scrolling.
  safe(() => swipeBehavior.mount());
  safe(() => swipeBehavior.disableVertical());
  try {
    await Promise.race([viewport.mount(), new Promise((_, rej) => setTimeout(() => rej(new Error('viewport timeout')), 2500))]);
    safe(() => viewport.expand());
    applyInsets();
    safe(() => on('safe_area_changed', applyInsets));
    safe(() => on('content_safe_area_changed', applyInsets));
    safe(() => on('viewport_changed', applyInsets));
  } catch {
    /* older clients: CSS env() fallback in tokens.css */
  }
  safe(() => miniApp.ready());
  return state;
}

export const tg = {
  get mode() {
    return state.mode;
  },
  get initData() {
    return state.initData;
  },
  get botUsername() {
    return state.botUsername;
  },
  setBotUsername(v: string | null) {
    if (v) state.botUsername = v;
  },
  get startParam() {
    return state.startParam;
  },
  backButton: {
    show: () => safe(() => backButton.show()),
    hide: () => safe(() => backButton.hide()),
    onClick: (fn: () => void) => safe(() => backButton.onClick(fn)) ?? (() => {}),
  },
  haptic: {
    tap: () => safe(() => hapticFeedback.impactOccurred('light')),
    medium: () => safe(() => hapticFeedback.impactOccurred('medium')),
    select: () => safe(() => hapticFeedback.selectionChanged()),
    success: () => safe(() => hapticFeedback.notificationOccurred('success')),
    warning: () => safe(() => hapticFeedback.notificationOccurred('warning')),
    error: () => safe(() => hapticFeedback.notificationOccurred('error')),
  },
  /** Telegram's native "send to chat" picker; Web Share / clipboard outside Telegram. */
  async share(url: string, text: string): Promise<'telegram' | 'native' | 'copied' | 'failed'> {
    const tgShare = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    if (state.mode === 'telegram' && safe(() => openTelegramLink(tgShare)) !== undefined) return 'telegram';
    try {
      if (navigator.share) {
        await navigator.share({ url, text });
        return 'native';
      }
    } catch {
      /* cancelled */
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      return 'copied';
    } catch {
      return 'failed';
    }
  },
  openBot(link?: string) {
    const url = link ?? (state.botUsername ? `https://t.me/${state.botUsername}?start=download` : undefined);
    if (!url) return false;
    if (state.mode === 'telegram' && safe(() => openTelegramLink(url)) !== undefined) return true;
    window.open(url, '_blank', 'noopener');
    return true;
  },
};
