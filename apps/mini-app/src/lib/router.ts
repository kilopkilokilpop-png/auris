import { useEffect } from 'react';
import { Store, useStore } from './store';
import { tg } from './telegram';
import { player } from './player';
import { withTransition } from './transition';

export type Tab = 'home' | 'wave' | 'hear' | 'profile';
export type Overlay =
  | { name: 'search' }
  | { name: 'settings' }
  | { name: 'album'; id: string }
  | { name: 'artist'; id: string }
  | { name: 'playlist'; id: string; title: string }
  | { name: 'collection'; id: string; title: string }
  | { name: 'onboarding' };

export const nav = new Store<{ tab: Tab; stack: Overlay[] }>({ tab: 'home', stack: [] });

const TAB_ORDER: Tab[] = ['home', 'wave', 'hear', 'profile'];

export function openPlayer() {
  if (player.state.expanded) return;
  tg.haptic.tap();
  withTransition('player-open', () => player.expand(true));
}
export function closePlayer() {
  if (!player.state.expanded) return;
  withTransition('player-close', () => player.expand(false));
}

export const go = {
  tab(tab: Tab) {
    const s = nav.get();
    if (s.tab === tab && s.stack.length === 0 && !player.state.expanded) return;
    tg.haptic.select();
    const forward = TAB_ORDER.indexOf(tab) >= TAB_ORDER.indexOf(s.tab);
    document.documentElement.dataset.dir = forward ? 'fwd' : 'rev';
    withTransition('tab', () => {
      nav.set({ tab, stack: [] });
      player.expand(false);
    });
  },
  push(o: Overlay) {
    tg.haptic.tap();
    withTransition('push', () => {
      nav.set((s) => ({ stack: [...s.stack, o] }));
      player.expand(false);
    });
  },
  back() {
    if (player.state.expanded) return closePlayer();
    if (!nav.get().stack.length) return;
    withTransition('back', () => nav.set((s) => ({ stack: s.stack.slice(0, -1) })));
  },
};

/** Telegram BackButton mirrors our in-app history. */
export function useTelegramBackButton() {
  const depth = useStore(nav, (s) => s.stack.length);
  const expanded = useStore(player.store, (s) => s.expanded);
  useEffect(() => {
    if (depth > 0 || expanded) tg.backButton.show();
    else tg.backButton.hide();
  }, [depth, expanded]);
  useEffect(() => tg.backButton.onClick(() => go.back()), []);
}
