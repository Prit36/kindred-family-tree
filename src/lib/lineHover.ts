import { useSyncExternalStore } from 'react';

/**
 * The connector line being rested on (or tapped) on the canvas, kept outside React state
 * so that moving the pointer along a line re-renders only what shows it - the highlight,
 * its card, and the few cards it joins - rather than the whole canvas.
 */
export type LineTarget = { kind: 'union'; id: string } | { kind: 'family'; key: string };

export type LineHover = LineTarget & {
  /** Pointer position in the viewport */
  x: number;
  y: number;
  /** Tapped or clicked: stays up until dismissed */
  pinned: boolean;
  /** The people the line joins */
  ids: ReadonlySet<string>;
};

let current: LineHover | null = null;
const listeners = new Set<() => void>();

export const lineHover = {
  get: () => current,
  set(next: LineHover | null) {
    if (next === current) return;
    current = next;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useLineHover(): LineHover | null {
  return useSyncExternalStore(lineHover.subscribe, lineHover.get);
}

/** Whether this person is joined by the line being rested on. */
export function useLinkedByLine(id: string): boolean {
  return useSyncExternalStore(lineHover.subscribe, () => Boolean(current?.ids.has(id)));
}
