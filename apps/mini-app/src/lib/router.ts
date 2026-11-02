import { useEffect } from 'react';
import { Store, useStore } from './store';
import { tg } from './telegram';
import { player } from './player';

export type Tab = 'home' | 'wave' | 'hear' | 'profile';
export type Overlay =
  | { name: 'search' }
  | { name: 'settings' }
  | { name: 'album'; id: string }
  | { name: 'artist'; id: string }
  | { name: 'playlist'; id: string; title: string }
  | { name: 'onboarding' };

export const nav = new Store<{ tab: Tab; stack: Overlay[] }>({ tab: 'home', stack: [] });

export const go = {
  tab(tab: Tab) {
    if (nav.get().tab !== tab) tg.haptic.select();
    nav.set({ tab, stack: [] });
    player.expand(false);
  },
  push(o: Overlay) {
    tg.haptic.tap();
    nav.set((s) => ({ stack: [...s.stack, o] }));
    player.expand(false);
  },
  back() {
    if (player.state.expanded) return player.expand(false);
    nav.set((s) => ({ stack: s.stack.slice(0, -1) }));
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
