import { useStore } from '../store';

/** A finger, not a mouse, is the main way in. */
export const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

/** How long a finger rests on someone before it counts as a hold. */
const HOLD_MS = 480;
/** A finger that wanders further than this is panning, not holding. */
const SLOP = 10;

/** Someone drawn in the tree, the descendants fan or the timeline. */
const PERSON = '.viewport [data-person-id], .fan [data-person-id], .timeline [data-person-id]';

/**
 * Touch and hold someone: the touch screen's Shift+click. It shows how they are related
 * to the selected person (or selects them if nobody is). Installed once, on the window,
 * so it works the same in every view. Returns the uninstaller.
 */
export function installTouchHold(): () => void {
  let timer = 0;
  let start: { id: number; x: number; y: number } | null = null;
  // The tap the system sends after a hold is not a tap of its own.
  let swallowUntil = 0;

  const cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
    start = null;
  };

  const onDown = (e: PointerEvent) => {
    // A second finger is a pinch.
    if (e.pointerType !== 'touch' || !e.isPrimary) return cancel();
    const id = (e.target as Element | null)?.closest?.(PERSON)?.getAttribute('data-person-id');
    if (!id) return;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY };
    timer = window.setTimeout(() => {
      timer = 0;
      start = null;
      const { dialog, compare } = useStore.getState();
      if (dialog) return;
      swallowUntil = Date.now() + 900;
      navigator.vibrate?.(12);
      compare(id);
    }, HOLD_MS);
  };

  const onMove = (e: PointerEvent) => {
    if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel();
  };

  const swallow = (e: Event) => {
    if (Date.now() > swallowUntil) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'click') swallowUntil = 0;
  };

  // A held finger would otherwise bring up the browser's own menu.
  const onMenu = (e: Event) => {
    if (timer || Date.now() <= swallowUntil) e.preventDefault();
  };

  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', cancel, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('click', swallow, true);
  window.addEventListener('dblclick', swallow, true);
  window.addEventListener('contextmenu', onMenu, true);
  return () => {
    cancel();
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', cancel, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('click', swallow, true);
    window.removeEventListener('dblclick', swallow, true);
    window.removeEventListener('contextmenu', onMenu, true);
  };
}
