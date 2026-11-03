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

export const ui = new Store<{ toast: Toast | null; sheet: SheetState; sheetClosing: boolean; toastClosing: boolean }>({ toast: null, sheet: null, sheetClosing: false, toastClosing: false });
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let n = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, action?: Toast['action'], ms = 3200) {
  clearTimeout(timer);
  ui.set({ toast: { id: ++n, text, action }, toastClosing: false });
  timer = setTimeout(() => {
    ui.set({ toastClosing: true });
    timer = setTimeout(() => ui.set({ toast: null, toastClosing: false }), reduced() ? 0 : 180);
  }, action ? ms + 2500 : ms);
}
let sheetTimer: ReturnType<typeof setTimeout> | undefined;
export const openSheet = (s: SheetState) => {
  clearTimeout(sheetTimer);
  ui.set({ sheet: s, sheetClosing: false });
};
/** Plays the slide-down before unmounting. */
export const closeSheet = () => {
  if (!ui.get().sheet || ui.get().sheetClosing) return;
  ui.set({ sheetClosing: true });
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(() => ui.set({ sheet: null, sheetClosing: false }), reduced() ? 0 : 220);
};
