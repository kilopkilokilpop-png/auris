import { flushSync } from 'react-dom';

export type TransitionKind = 'push' | 'back' | 'tab' | 'player-open' | 'player-close';

type VTDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let running = false;

/**
 * Runs a navigation state change inside a View Transition (Chromium WebViews, Telegram Desktop,
 * iOS 18+). Elements sharing a view-transition-name (the "now playing" cover) morph between screens.
 * Falls back to an instant change + CSS keyframes; skipped entirely with reduced motion.
 */
export function withTransition(kind: TransitionKind, change: () => void) {
  const doc = document as VTDocument;
  if (!doc.startViewTransition || reducedMotion() || running) {
    change();
    return;
  }
  running = true;
  document.documentElement.dataset.vt = kind;
  try {
    const t = doc.startViewTransition(() => flushSync(change));
    void t.finished.finally(() => {
      running = false;
      delete document.documentElement.dataset.vt;
    });
  } catch {
    running = false;
    delete document.documentElement.dataset.vt;
    change();
  }
}
