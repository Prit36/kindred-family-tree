import { flushSync } from 'react-dom';
import { useStore, type ViewMode } from '../store';

/** The views in the order the header lists them: moving right slides the page left. */
const ORDER: ViewMode[] = ['tree', 'fan', 'timeline', 'cards'];

let current: ViewTransition | null = null;

/**
 * Switches view with the old one sliding out and the new one sliding in from the side
 * its tab is on. The header and details panel stay put. A plain cut where the browser has
 * no view transitions or motion is turned down.
 */
export function switchView(mode: ViewMode) {
  const { mode: from, setMode } = useStore.getState();
  if (from === mode) return;
  if (
    !document.startViewTransition ||
    document.visibilityState !== 'visible' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    setMode(mode);
    return;
  }
  const root = document.documentElement;
  root.dataset.viewSwap = ORDER.indexOf(mode) > ORDER.indexOf(from) ? 'forward' : 'back';
  const vt = document.startViewTransition(() => flushSync(() => setMode(mode)));
  // A switch cut short by another one is fine: the newer one carries on.
  vt.ready.catch(() => {});
  current = vt;
  void vt.finished.finally(() => {
    if (current === vt) delete root.dataset.viewSwap;
  });
}
