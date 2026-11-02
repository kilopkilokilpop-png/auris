import type { ReactNode } from 'react';
import type { Track } from '@auris/shared';
import { Store } from './store';

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
export type SheetState =
  | { kind: 'track'; track: Track; context?: string }
  | { kind: 'info'; title: string; body: ReactNode; action?: { label: string; run: () => void } }
  | { kind: 'playlist-pick'; track: Track }
  | null;

export const ui = new Store<{ toast: Toast | null; sheet: SheetState }>({ toast: null, sheet: null });

let n = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, action?: Toast['action'], ms = 3200) {
  clearTimeout(timer);
  ui.set({ toast: { id: ++n, text, action } });
  timer = setTimeout(() => ui.set({ toast: null }), action ? ms + 2500 : ms);
}
export const openSheet = (s: SheetState) => ui.set({ sheet: s });
export const closeSheet = () => ui.set({ sheet: null });
