import { useEffect, useState } from 'react';
import { MiniPlayer } from './components/MiniPlayer';
import { SheetHost, ToastHost } from './components/Overlays';
import { TabBar } from './components/TabBar';
import { LogoMark } from './components/Icons';
import { api, ApiFailure } from './lib/api';
import { player } from './lib/player';
import { go, nav, useTelegramBackButton, type Overlay } from './lib/router';
import { loadSession } from './lib/session';
import { useStore } from './lib/store';
import { tg } from './lib/telegram';
import { AlbumScreen, ArtistScreen, PlaylistScreen } from './screens/Collection';
import { Hear } from './screens/Hear';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Player } from './screens/Player';
import { Profile } from './screens/Profile';
import { Search } from './screens/Search';
import { Settings } from './screens/Settings';
import { Wave } from './screens/Wave';

type Boot = { k: 'loading' } | { k: 'ready' } | { k: 'error'; title: string; text: string };

function OverlayView({ o }: { o: Overlay }) {
  switch (o.name) {
    case 'search':
      return <Search />;
    case 'settings':
      return <Settings />;
    case 'album':
      return <AlbumScreen id={o.id} />;
    case 'artist':
      return <ArtistScreen id={o.id} />;
    case 'playlist':
      return <PlaylistScreen id={o.id} title={o.title} />;
    case 'onboarding':
      return <Onboarding />;
  }
}

/** ?screen=wave|hear|profile|settings|search, ?track=<id>, or Telegram start_param "track_<provider>_<id>" */
async function applyDeepLink() {
  const p = new URLSearchParams(location.search);
  const start = tg.startParam;
  const screen = p.get('screen') ?? (start && !start.startsWith('track_') ? start : null);
  if (screen === 'wave' || screen === 'hear' || screen === 'profile') go.tab(screen);
  if (screen === 'settings') go.push({ name: 'settings' });
  if (screen === 'search') go.push({ name: 'search' });
  const trackId = p.get('track') ?? (start?.startsWith('track_') ? start.slice(6).replace('_', ':') : null);
  if (trackId) {
    const t = await api.track(trackId).catch(() => null);
    if (t) {
      // Opening from the bot is not a user gesture inside the WebView: show the player, play on tap.
      player.store.set({ queue: [t], index: 0, context: { label: 'Из бота', kind: 'list' }, expanded: true, position: 0, duration: t.playback.playableSec, streamKind: t.playback.kind === 'none' ? null : t.playback.kind });
    }
  }
}

export function App({ bootError }: { bootError?: string }) {
  const [boot, setBoot] = useState<Boot>(bootError ? { k: 'error', title: 'Откройте AURIS в Telegram', text: bootError } : { k: 'loading' });
  const tab = useStore(nav, (s) => s.tab);
  const stack = useStore(nav, (s) => s.stack);
  const expanded = useStore(player.store, (s) => s.expanded);
  const hasTrack = useStore(player.store, (s) => s.index >= 0 && s.queue.length > 0);
  useTelegramBackButton();

  useEffect(() => {
    if (bootError) return;
    loadSession()
      .then(() => {
        setBoot({ k: 'ready' });
        void applyDeepLink();
      })
      .catch((e: unknown) => {
        const unauthorized = e instanceof ApiFailure && e.code === 'UNAUTHORIZED';
        setBoot({ k: 'error', title: unauthorized ? 'Не удалось войти' : 'Сервер недоступен', text: (e as Error).message });
      });
  }, [bootError]);

  if (boot.k !== 'ready') {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="center" aria-live="polite">
          <LogoMark size={56} />
          <p className="brand-word" style={{ marginTop: 16 }}>
            AURIS
          </p>
          {boot.k === 'loading' ? (
            <p className="muted">Слышать каждую ноту</p>
          ) : (
            <>
              <h1 className="h2" style={{ marginTop: 18 }}>
                {boot.title}
              </h1>
              <p className="muted" style={{ maxWidth: 300 }}>
                {boot.text}
              </p>
              {boot.title !== 'Откройте AURIS в Telegram' ? (
                <button type="button" className="btn primary" onClick={() => location.reload()}>
                  Повторить
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    );
  }

  const top = stack[stack.length - 1];
  return (
    <div className={`app ${hasTrack ? 'has-mini' : ''}`}>
      <div hidden={!!top} style={{ display: top ? 'none' : undefined }}>
        {tab === 'home' ? <Home /> : null}
        {tab === 'wave' ? <Wave /> : null}
        {tab === 'hear' ? <Hear /> : null}
        {tab === 'profile' ? <Profile /> : null}
      </div>
      {top ? <OverlayView key={stack.length} o={top} /> : null}
      {!expanded ? <MiniPlayer /> : null}
      {!top || top.name !== 'onboarding' ? <TabBar /> : null}
      {expanded ? <Player /> : null}
      <SheetHost />
      <ToastHost />
    </div>
  );
}
