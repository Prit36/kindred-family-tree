import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { EyeOff, House, Maximize, Minus, Network, Plus, UsersRound } from 'lucide-react';
import type { Relation, Tree } from '../types';
import { shownLine, trailOf, useStore } from '../store';
import {
  CARD_H,
  CARD_W,
  TOGGLE_GAP,
  UNION_RING,
  computeLayout,
  familyStem,
  type Box,
  type ChildLink,
  type LayoutAnchor,
  type TreeLayout,
  type UnionLine,
} from '../lib/layout';
import { branchToggles, focusSet, subTree, visibleIds } from '../lib/branches';
import { bridgeOf, familyWords, type Bridge } from '../lib/lines';
import { familySides } from '../lib/sides';
import { relationLabels } from '../lib/naming';
import { shapeOf } from '../lib/shape';
import { lineHover, useLineHover, type LineTarget } from '../lib/lineHover';
import { ancestorIds, childrenOf, descendantIds, fullName, isPlaceholder, pathBetween, shortName } from '../lib/tree';
import { addRelative } from '../lib/actions';
import { downloadTreePng } from '../lib/files';
import { canvasHandle } from '../lib/canvasHandle';
import { PersonCard } from './PersonCard';
import { SidesLegend } from './SidesLegend';
import type { DeckCard } from './FamilyDeck';
import { FamilyBar } from './FamilyBar';
import { ConnectorTip, type Connector } from './ConnectorTip';
import { countPeople, num } from '../lib/format';

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const ARROWS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const familyKey = (parentIds: string[]) => [...parentIds].sort().join('|');

/** How each kind of couple line is drawn: married solid, partners dashed, divorced dotted. */
const UNION_DASH: Record<string, string | undefined> = { married: undefined, partner: '9 6', divorced: '2 7' };

const MIN_ZOOM = 0.15;
/**
 * Below this zoom names are too small to read, so cards switch to a glance view: the
 * relationship ("Father", "Wife") and first name in large type, on their side's colour.
 */
const FAR_ZOOM = 0.62;
const MAX_ZOOM = 2;
const TOP_INSET = 52;
/** How long after the tree changes newly shown people and lines fade in. */
const FRESH_MS = 700;

/**
 * Only what is on screen, plus a margin, is put in the page: on a tree of thousands that
 * is a few hundred cards instead of every one. `Win` is that area in tree coordinates.
 */
interface Win {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const inWin = (w: Win | null, b: Box) => !w || (b[2] >= w.x0 && b[0] <= w.x1 && b[3] >= w.y0 && b[1] <= w.y1);
const cardBox = (x: number, y: number): Box => [x, y, x + CARD_W, y + CARD_H];

/** A family's parents and the children hanging from their line, keyed by `familyKey`. */
type Families = Map<string, { parents: string[]; children: string[] }>;

export function Canvas() {
  const tree = useStore((s) => s.tree);
  const selectedId = useStore((s) => s.selectedId);
  const compareId = useStore((s) => s.compareId);
  const focus = useStore((s) => s.focus);
  const focusId = focus?.id ?? null;
  const peek = useStore((s) => s.peek);
  const sideColours = useStore((s) => s.sides.colour);
  const collapsed = useStore((s) => s.collapsed);
  const view = useStore((s) => s.view);
  const select_ = useStore((s) => s.select);
  const compare = useStore((s) => s.compare);
  const openDialog = useStore((s) => s.openDialog);
  const toggleCollapse = useStore((s) => s.toggleCollapse);

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);

  // What is drawn: the area around the screen, the zoom level's style of card, and - while
  // an image is being saved - everything, in full.
  const [win, setWin] = useState<Win>({ x0: 0, y0: 0, x1: 0, y1: 0 });
  const winRef = useRef<Win | null>(null);
  const [far, setFar] = useState(false);
  const farRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const drawWin = exporting ? null : win;
  const drawFar = far && !exporting;

  // Only the people on show are laid out: a focused branch, one family line, or the tree
  // minus its folded branches. Everything drawn below works from `shown`, never from the
  // full tree.
  const lines = useStore((s) => s.lines);
  const line = useMemo(() => shownLine(tree, lines), [tree, lines]);
  /** One family is what's on show (a focus takes its place while there is one). */
  const byLine = line !== null && !focus;
  const visible = useMemo(() => visibleIds(tree, focus, collapsed, line), [tree, focus, collapsed, line]);
  const shown = useMemo(() => subTree(tree, visible), [tree, visible]);
  const total = Object.keys(tree.people).length;
  const hiddenCount = total - visible.size;

  // Keep whoever the user is looking at pinned in place when the tree changes - or, when a
  // branch is folded, the card it was folded at.
  const previous = useRef<{ layout: TreeLayout; selectedId: string | null; focusId: string | null } | null>(null);
  const foldedAt = useRef<string | null>(null);
  // Laid out again only when who is shown or how they're connected changes - not when
  // someone's notes, photo or name are edited (see lib/shape.ts).
  const shape = shapeOf(shown);
  const layout = useMemo(() => {
    const prev = previous.current;
    let anchor: LayoutAnchor | undefined;
    if (prev) {
      const usable = (id: string | null | undefined): id is string =>
        Boolean(id && prev.layout.nodes[id] && shown.people[id]);
      // With nobody selected (the selected person was just deleted, say), whoever is
      // nearest the middle of the screen stays put - not "me", who may be far off.
      const nearestMiddle = () => {
        const viewport = viewportRef.current;
        if (!viewport) return undefined;
        const t = zoomTransform(viewport);
        const cx = t.invertX(viewport.clientWidth / 2) - CARD_W / 2;
        const cy = t.invertY(viewport.clientHeight / 2) - CARD_H / 2;
        let best: string | undefined;
        let bestD = Infinity;
        for (const id in prev.layout.nodes) {
          if (!shown.people[id]) continue;
          const n = prev.layout.nodes[id];
          const d = (n.x - cx) ** 2 + (n.y - cy) ** 2;
          if (d < bestD) [best, bestD] = [id, d];
        }
        return best;
      };
      const id =
        [foldedAt.current, selectedId, prev.selectedId].find(usable) ??
        nearestMiddle() ??
        [prev.focusId, tree.homeId].find(usable) ??
        Object.keys(prev.layout.nodes).find(usable);
      if (id) anchor = { id, ...prev.layout.nodes[id] };
    }
    return computeLayout(shown, anchor);
    // selectedId is read on purpose without being a dependency: only a change in who is shown re-layouts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Who and what is new since the last layout, to fade in.
  const fresh = useMemo(() => {
    const prev = previous.current?.layout;
    const until = performance.now() + FRESH_MS;
    if (!prev) return { all: true, nodes: null, unions: null, until };
    const nodes = new Set<string>();
    for (const id in layout.nodes) if (!prev.nodes[id]) nodes.add(id);
    const before = new Set(prev.unions.map((u) => u.id));
    const unions = new Set(layout.unions.filter((u) => !before.has(u.id)).map((u) => u.id));
    return { all: false, nodes, unions, until };
  }, [layout]);
  const freshNow = performance.now() < fresh.until;
  const isFreshNode = (id: string) => freshNow && (fresh.all || fresh.nodes!.has(id));
  const isFreshUnion = (id: string) => freshNow && (fresh.all || fresh.unions!.has(id));

  useEffect(() => {
    previous.current = { layout, selectedId, focusId };
    foldedAt.current = null;
  });

  const naming = useStore((s) => s.naming);
  const words = familyWords(naming);
  const kin = relationLabels(tree, naming);
  // Cards redraw their names when the script changes, or a Gujarati spelling is corrected.
  const nameStyle = naming === 'gu' ? (tree.spellings ?? naming) : 'latin';
  const sides = familySides(tree);
  // Hovering a side in the list lights it up and dims everyone else.
  const peeked = useMemo(() => (peek ? focusSet(tree, peek) : null), [tree, peek]);

  const lineage = useMemo(() => {
    if (!selectedId || !shown.people[selectedId]) return null;
    return new Set([selectedId, ...ancestorIds(shown, selectedId), ...descendantIds(shown, selectedId)]);
  }, [shown, selectedId]);

  // The chain of people between the selected person and "me" (or whoever they're being
  // compared with) - it's what makes a label like "Cousin once removed" make sense.
  // It's traced through the people on show; if the other end is hidden there's no chain to draw.
  const pathFrom = compareId && shown.people[compareId] ? compareId : shown.homeId;
  const path = useMemo(() => {
    if (!selectedId || !pathFrom || pathFrom === selectedId) return null;
    const ids = pathBetween(shown, pathFrom, selectedId);
    if (!ids || ids.length < 2) return null;
    const cards = new Set(ids);
    const childLinks = new Set<string>();
    const unions = new Set<string>();
    const parentsOf = (id: string) => shown.people[id].parentIds;
    for (let i = 0; i < ids.length - 1; i++) {
      const [a, b] = [ids[i], ids[i + 1]];
      if (parentsOf(b).includes(a)) childLinks.add(b);
      else if (parentsOf(a).includes(b)) childLinks.add(a);
      else unions.add(pairKey(a, b));
    }
    // A hop between siblings runs through one parent; light up the other shared parent too.
    for (let i = 1; i < ids.length - 1; i++) {
      const [prev, mid, next] = [ids[i - 1], ids[i], ids[i + 1]];
      if (!parentsOf(prev).includes(mid) || !parentsOf(next).includes(mid)) continue;
      const other = parentsOf(prev).find((p) => p !== mid && parentsOf(next).includes(p));
      if (other) {
        cards.add(other);
        unions.add(pairKey(mid, other));
      }
    }
    return { cards, childLinks, unions };
  }, [shown, selectedId, pathFrom]);

  // --- Collapse toggles -------------------------------------------------------
  // A small button on each line that can be folded: under a couple to tuck their children's
  // branches away, above a person to tuck away their parents' side of the family.
  const toggles = useMemo(() => {
    if (focusId || byLine) return [];
    return branchToggles(tree, collapsed).flatMap((t) => {
      let x: number;
      let y: number;
      let from: number;
      if (t.kind === 'down') {
        const stem = familyStem(layout, t.ids);
        if (!stem) return [];
        [x, y, from] = [stem.x, stem.toggleY, stem.y];
      } else {
        const pos = layout.nodes[t.ids[0]];
        if (!pos) return [];
        [x, y, from] = [pos.x + CARD_W / 2, pos.y - TOGGLE_GAP, pos.y];
      }
      const names = t.ids.map((id) => shortName(tree.people[id])).join(' and ');
      const where = t.kind === 'down' ? `below ${names}` : `on ${names}'s parents' side`;
      const label = t.collapsed
        ? `Show the ${countPeople(t.count)} hidden ${where}`
        : `Hide the ${countPeople(t.count)} ${where}`;
      const box: Box = [x - 20, Math.min(y, from) - 14, x + 20, Math.max(y, from) + 14];
      return [{ ...t, x, y, from, label, box }];
    });
  }, [tree, collapsed, focusId, byLine, layout]);

  // --- Bridges between families ---------------------------------------------------
  // Someone who married in carries a tag for the family they came from; someone who married
  // out is a dashed card, tagged with the family they married into. Each leads there.
  const bridges = useMemo(() => {
    const out = new Map<string, Bridge>();
    if (!byLine || !line) return out;
    for (const id of visible) {
      const b = bridgeOf(tree, line, id, naming);
      if (b) out.set(id, b);
    }
    return out;
  }, [tree, byLine, line, visible, naming]);
  const showLine = useStore((s) => s.showLine);
  const bridgesRef = useRef(bridges);
  bridgesRef.current = bridges;
  const onBridge = useCallback(
    (id: string) => {
      const b = bridgesRef.current.get(id);
      if (!b) return;
      // The same person is on both sides of the bridge, so they stay where they are.
      foldedAt.current = id;
      showLine(b.line, id);
    },
    [showLine],
  );

  // --- The deck of linked families ----------------------------------------------
  // Every family a bridge leads to is a card in the deck, left to right in the order of the
  // people leading there, so their threads cross as little as they can.
  const deck = useMemo<DeckCard[]>(() => {
    const by = new Map<string, string[]>();
    for (const [id, b] of bridges) {
      if (!layout.nodes[id]) continue;
      const via = by.get(b.line);
      if (via) via.push(id);
      else by.set(b.line, [id]);
    }
    const x = (id: string) => layout.nodes[id].x;
    const mean = (ids: string[]) => ids.reduce((sum, id) => sum + x(id), 0) / ids.length;
    return [...by]
      .map(([line, via]) => ({ line, via: via.sort((a, b) => x(a) - x(b)) }))
      .sort((a, b) => mean(a.via) - mean(b.via));
  }, [bridges, layout]);
  const onDeck = useCallback(
    (card: DeckCard) => {
      foldedAt.current = card.via[0];
      showLine(card.line, card.via[0]);
    },
    [showLine],
  );

  // A thread runs from each card in the deck down to everyone leading to that family. The
  // threads are drawn straight onto the page as the tree pans (not re-rendered).
  const threadsRef = useRef<SVGSVGElement>(null);
  /** Where each family's card in the deck takes its threads: the middle of its bottom edge. */
  const anchors = useRef(new Map<string, { x: number; y: number }>());
  const drawThreads = useCallback((t?: ZoomTransform) => {
    const svg = threadsRef.current;
    const vp = viewportRef.current;
    if (!svg || !vp) return;
    const { x: tx, y: ty, k } = t ?? zoomTransform(vp);
    const nodes = layoutRef.current.nodes;
    for (const g of Array.from(svg.children) as SVGGElement[]) {
      const from = anchors.current.get(g.dataset.line!);
      const n = nodes[g.dataset.via!];
      const cx = n ? tx + (n.x + CARD_W / 2) * k : 0;
      const cy = n ? ty + n.y * k : 0;
      // A card passing up behind the deck lets go of its thread.
      if (!from || !n || cy < from.y + 12) {
        g.style.display = 'none';
        continue;
      }
      g.style.display = '';
      const bend = Math.max(36, (cy - from.y) * 0.5);
      g.firstElementChild!.setAttribute('d', `M${from.x} ${from.y}C${from.x} ${from.y + bend} ${cx} ${cy - bend} ${cx} ${cy}`);
      g.lastElementChild!.setAttribute('cx', `${cx}`);
      g.lastElementChild!.setAttribute('cy', `${cy}`);
    }
  }, []);
  const measureDeck = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const box = vp.getBoundingClientRect();
    const out = new Map<string, { x: number; y: number }>();
    for (const el of vp.querySelectorAll<HTMLElement>('.family-chip')) {
      const r = el.getBoundingClientRect();
      out.set(el.dataset.line!, { x: r.left + r.width / 2 - box.left, y: r.bottom - box.top });
    }
    anchors.current = out;
    drawThreads();
  }, [drawThreads]);
  // After every render (the deck can shift with the families visited, the trail's length or
  // a late font) - it's only a few cards to measure.
  useLayoutEffect(measureDeck);
  useEffect(() => {
    document.fonts?.ready.then(measureDeck);
  }, [measureDeck]);
  /** Lights up one family's card and threads (resting on the card, or on a bridge to it). */
  const lightLine = useCallback((line: string | null) => {
    const vp = viewportRef.current;
    if (!vp) return;
    for (const el of vp.querySelectorAll<HTMLElement | SVGElement>('.family-chip, .deck-threads > g, .bridge[data-line]')) {
      el.classList.toggle('is-hot', line !== null && el.dataset.line === line);
    }
  }, []);

  const toggleKeysBefore = useRef<Set<string> | null>(null);
  const freshToggles = useMemo(() => {
    const before = toggleKeysBefore.current;
    toggleKeysBefore.current = new Set(toggles.map((t) => t.key));
    return before ? new Set(toggles.filter((t) => !before.has(t.key)).map((t) => t.key)) : null;
  }, [toggles]);

  const placeholders = useMemo(
    () => new Set(Object.values(tree.people).filter(isPlaceholder).map((p) => p.id)),
    [tree],
  );

  // --- What is on screen -------------------------------------------------------
  /** Works out from the view whether a different area (or kind of card) needs drawing. */
  const syncView = useCallback((t: ZoomTransform) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const isFar = t.k < FAR_ZOOM;
    if (isFar !== farRef.current) {
      farRef.current = isFar;
      setFar(isFar);
    }
    const w = vp.clientWidth;
    const h = vp.clientHeight;
    if (!w || !h) return;
    const vis = { x0: -t.x / t.k, y0: -t.y / t.k, x1: (w - t.x) / t.k, y1: (h - t.y) / t.k };
    const cur = winRef.current;
    const area = (r: Win) => (r.x1 - r.x0) * (r.y1 - r.y0);
    const covers = cur && cur.x0 <= vis.x0 && cur.y0 <= vis.y0 && cur.x1 >= vis.x1 && cur.y1 >= vis.y1;
    // Redrawn when the view leaves the drawn area, or after zooming in a long way (when most
    // of what is drawn is far off screen).
    if (covers && area(cur) <= area(vis) * 12) return;
    // Half a screen of margin all round, so ordinary panning needs no redraw at all.
    const mx = (vis.x1 - vis.x0) / 2;
    const my = (vis.y1 - vis.y0) / 2;
    const next = { x0: vis.x0 - mx, y0: vis.y0 - my, x1: vis.x1 + mx, y1: vis.y1 + my };
    winRef.current = next;
    setWin(next);
  }, []);

  // --- Pan & zoom -----------------------------------------------------------
  useEffect(() => {
    const viewport = viewportRef.current!;
    const world = worldRef.current!;
    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .filter((event: Event) => {
        const e = event as MouseEvent;
        if (e.type === 'wheel') return true;
        if (e.button) return false;
        // Let buttons on the canvas be clicked without starting a drag.
        return !(e.target as HTMLElement).closest('.quick-add, .branch-toggle, .bridge, .canvas-controls, .sides, .line-head');
      })
      .on('zoom', (event: { transform: ZoomTransform }) => {
        const t = event.transform;
        world.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
        // The line moves out from under the pointer, so whatever it explained goes.
        if (lineHover.get()) lineHover.set(null);
        // Glance labels are sized against the zoom (in steps, to spare restyling every frame).
        if (t.k < FAR_ZOOM) {
          const k = (Math.round(t.k * 40) / 40).toString();
          if (world.style.getPropertyValue('--k') !== k) world.style.setProperty('--k', k);
        }
        let grid = 28 * t.k;
        while (grid < 16) grid *= 2;
        viewport.style.backgroundSize = `${grid}px ${grid}px`;
        viewport.style.backgroundPosition = `${t.x}px ${t.y}px`;
        syncView(t);
        drawThreads(t);
      });
    zoomRef.current = behavior;
    select(viewport).call(behavior).on('dblclick.zoom', null);
    syncView(zoomTransform(viewport));
    // A bigger window shows more of the tree.
    const resize = new ResizeObserver(() => {
      syncView(zoomTransform(viewport));
      measureDeck();
    });
    resize.observe(viewport);
    return () => {
      resize.disconnect();
      select(viewport).on('.zoom', null);
      lineHover.set(null);
    };
  }, [syncView, drawThreads, measureDeck]);

  /** Screen area not covered by the top bar or the details panel. */
  const visibleArea = useCallback(() => {
    const viewport = viewportRef.current!;
    const left = 0;
    // Below the top bar - and below the family bar, when there is one.
    const deckEl = viewport.querySelector('.line-head');
    const top = deckEl
      ? Math.max(TOP_INSET, deckEl.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top + 16)
      : TOP_INSET;
    let right = viewport.clientWidth;
    let bottom = viewport.clientHeight;
    // The panel docks to the right on wide screens and becomes a bottom sheet on narrow ones.
    const panel = document.querySelector('.panel')?.getBoundingClientRect();
    if (panel) {
      if (panel.width < viewport.clientWidth * 0.6) right = viewport.clientWidth - panel.width - 24;
      else bottom = Math.max(top + 120, panel.top - 12);
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }, []);

  const moveTo = useCallback((t: ZoomTransform, animate: boolean) => {
    const viewport = viewportRef.current!;
    const behavior = zoomRef.current!;
    if (animate) select(viewport).transition().duration(480).call(behavior.transform, t);
    else select(viewport).interrupt().call(behavior.transform, t);
  }, []);

  // --- Swapping families -----------------------------------------------------------
  /** What floats over the canvas, kept above the shuffle (each named on its own for it). */
  const CHROME = [
    ['.topbar', 'chrome-top'],
    ['.line-head', 'chrome-deck'],
    ['.canvas-controls', 'chrome-controls'],
    ['.panel', 'chrome-panel'],
  ] as const;
  // Moving to another family is a card shuffle: the family on show tilts back into the deck
  // as the other one's card comes forward and becomes the canvas. The browser's view
  // transitions do the flying (where there are none, or motion is turned down, it's a cut).
  const planeRef = useRef<HTMLDivElement>(null);
  const instantUntil = useRef(0);
  const lineNow = useRef<string | null>(null);
  lineNow.current = byLine ? line : null;
  useEffect(() => {
    let running: ViewTransition | null = null;
    // What is named for the shuffle under way. One at a time: a new shuffle cuts the last one
    // short, and starts by clearing its names (two of a name would spoil both).
    const named = new Set<HTMLElement>();
    const name = (el: HTMLElement | null, as: string) => {
      if (!el) return;
      el.style.viewTransitionName = as;
      // Its tip would be pictured with it, and grow with it.
      el.classList.add('is-flying');
      named.add(el);
    };
    const unname = () => {
      for (const el of named) {
        el.style.viewTransitionName = '';
        el.classList.remove('is-flying');
        // A stand-in made for the flight goes once it has flown.
        if (el.dataset.ghost !== undefined) el.remove();
      }
      named.clear();
    };
    // A chip flies as a copy laid over it, so the bar keeps its own chip and never shows a gap.
    const ghost = (el: HTMLElement | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const copy = el.cloneNode(true) as HTMLElement;
      copy.dataset.ghost = '';
      copy.removeAttribute('data-line');
      copy.setAttribute('aria-hidden', 'true');
      Object.assign(copy.style, {
        position: 'fixed',
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        margin: '0',
        pointerEvents: 'none',
      });
      document.body.append(copy);
      return copy;
    };
    canvasHandle.swapLine = (to, apply) => {
      const vp = viewportRef.current;
      const plane = planeRef.current;
      const from = lineNow.current;
      if (
        !vp ||
        !plane ||
        !document.startViewTransition ||
        from === to ||
        document.visibilityState !== 'visible' ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        apply();
        return;
      }
      running?.skipTransition();
      unname();
      const sheetOf = (l: string | null) =>
        l ? vp.querySelector<HTMLElement>(`.family-chip[data-line="${CSS.escape(l)}"]`) : null;
      // The chrome stays put, above the cards in the air: they fly under the bars, not over them.
      const chrome = () =>
        CHROME.forEach(([sel, as]) => name(document.querySelector<HTMLElement>(sel), as));
      // Before: the canvas is the card going back, the chosen card in the deck the one coming out.
      chrome();
      name(plane, 'family-out');
      name(ghost(sheetOf(to)), 'family-in');
      vp.dataset.shuffling = '';
      const vt = document.startViewTransition(() => {
        // A shuffle cut short by a newer one still makes its change, but names nothing.
        const current = running === vt;
        if (current) unname();
        instantUntil.current = performance.now() + 250;
        flushSync(apply);
        if (!current) return;
        // After: the canvas is the family come out, and the one it replaced has a card in the deck.
        chrome();
        name(plane, 'family-in');
        name(ghost(sheetOf(from)), 'family-out');
      });
      running = vt;
      vt.finished.finally(() => {
        if (running !== vt) return;
        unname();
        delete vp.dataset.shuffling;
        running = null;
        measureDeck();
      });
    };
    return () => {
      running?.skipTransition();
      canvasHandle.swapLine = null;
    };
  }, [measureDeck]);

  // Whoever led to the family just shown, to pick out once their card is drawn (it may
  // only be drawn after the view has moved to it).
  const arrival = useRef<{ id: string; until: number } | null>(null);
  const markArrival = useCallback(() => {
    const due = arrival.current;
    if (!due) return;
    if (performance.now() > due.until) {
      arrival.current = null;
      return;
    }
    const card = viewportRef.current?.querySelector<HTMLElement>(`.card-slot[data-person-id="${CSS.escape(due.id)}"] .card`);
    if (!card) return;
    arrival.current = null;
    card.classList.remove('is-arrived');
    void card.offsetWidth;
    card.classList.add('is-arrived');
    const done = (e: AnimationEvent) => {
      if (e.animationName !== 'card-arrive') return;
      card.classList.remove('is-arrived');
      card.removeEventListener('animationend', done);
    };
    card.addEventListener('animationend', done);
  }, []);
  useLayoutEffect(markArrival);

  // Respond to "fit", "focus on person" and "make sure person is visible" requests.
  useEffect(() => {
    const viewport = viewportRef.current!;
    const { nodes, bounds } = layoutRef.current;
    const area = visibleArea();
    // While families are swapped the cards fly as a whole, so the view jumps straight there.
    const animate = view.nonce > 0 && performance.now() > instantUntil.current;
    const margin = 56;
    const fitK = Math.max(
      MIN_ZOOM,
      Math.min(1, (area.width - margin * 2) / bounds.width, (area.height - margin * 2) / bounds.height),
    );

    // Another family was just shown: all of it in view if the names can still be read;
    // otherwise as much of it as fits at a size they can, round its middle, with whoever
    // led there still in sight. They're picked out for a moment, so the eye finds them.
    if (view.kind === 'line' && bounds.width > 0) {
      // FAR_ZOOM: the smallest size cards are drawn in full, names and all.
      const k = Math.max(fitK, FAR_ZOOM);
      let x = area.left + area.width / 2 - (bounds.minX + bounds.width / 2) * k;
      let y = area.top + area.height / 2 - (bounds.minY + bounds.height / 2) * k;
      if (k > fitK) {
        // Start from the top of the family rather than its middle generation.
        y = Math.min(y, area.top + margin - bounds.minY * k);
        const via = view.id ? nodes[view.id] : undefined;
        if (via) {
          const pad = 40;
          const [l, t] = [x + via.x * k, y + via.y * k];
          const [r, b] = [l + CARD_W * k, t + CARD_H * k];
          if (l < area.left + pad) x += area.left + pad - l;
          else if (r > area.right - pad) x -= r - (area.right - pad);
          if (t < area.top + pad) y += area.top + pad - t;
          else if (b > area.bottom - pad) y -= b - (area.bottom - pad);
        }
      }
      moveTo(zoomIdentity.translate(x, y).scale(k), animate);
      // Not when a family was simply chosen: then it's reached through the person at its top.
      arrival.current = view.id && view.id !== lineNow.current ? { id: view.id, until: performance.now() + 1500 } : null;
      markArrival();
      return;
    }

    if (view.kind === 'fit') {
      if (bounds.width === 0) return;
      const k = fitK;
      // When opening a tree too big to read at "fit" size, start on the home person (or
      // whoever led to the family on show) instead.
      const { tree: t, lines: l, focus: f } = useStore.getState();
      const startId = (!f && l.on && trailOf(t, l).at(-1)?.via) || t.homeId;
      const home = startId ? nodes[startId] : undefined;
      // A phone needs a little more size before names can be read.
      const readable = area.width < 600 ? 0.55 : 0.4;
      if (!animate && k < readable && home) {
        const hk = 0.8;
        const hx = area.left + area.width / 2 - (home.x + CARD_W / 2) * hk;
        const hy = area.top + area.height / 2 - (home.y + CARD_H / 2) * hk;
        moveTo(zoomIdentity.translate(hx, hy).scale(hk), false);
        return;
      }
      const x = area.left + (area.width - bounds.width * k) / 2 - bounds.minX * k;
      const y = area.top + (area.height - bounds.height * k) / 2 - bounds.minY * k;
      moveTo(zoomIdentity.translate(x, y).scale(k), animate);
      return;
    }

    const pos = view.id ? nodes[view.id] : undefined;
    if (!pos) return;
    const current = zoomTransform(viewport);
    if (view.kind === 'reveal') {
      const sx = current.applyX(pos.x);
      const sy = current.applyY(pos.y);
      const pad = 28;
      const inView =
        sx >= area.left + pad &&
        sy >= area.top + pad &&
        sx + CARD_W * current.k <= area.right - pad &&
        sy + CARD_H * current.k <= area.bottom - pad;
      if (inView) return;
    }
    const k = view.kind === 'line' ? Math.min(1, Math.max(current.k, 0.8)) : current.k < 0.5 ? 0.85 : current.k;
    const x = area.left + area.width / 2 - (pos.x + CARD_W / 2) * k;
    const y = area.top + area.height / 2 - (pos.y + CARD_H / 2) * k;
    moveTo(zoomIdentity.translate(x, y).scale(k), animate);
  }, [view, moveTo, visibleArea, markArrival]);

  const zoomBy = (factor: number) => {
    const viewport = viewportRef.current!;
    select(viewport).transition().duration(220).call(zoomRef.current!.scaleBy, factor);
  };


  // --- Keyboard --------------------------------------------------------------
  // Remembers which way you came so Up then Down returns to the same person.
  const trail = useRef({ up: new Map<string, string>(), down: new Map<string, string>() });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const { dialog, selectedId: current, tree: t, select: go, fitView, mode } = useStore.getState();
      const el = e.target as HTMLElement;
      // The timeline view has keys of its own.
      if (mode !== 'tree') return;
      if (dialog || el.closest('input, textarea, select, [role="menu"]')) return;

      const key = e.key.toLowerCase();
      if (key === 'f') return fitView();
      if (key === 'h') return useStore.getState().goHome();
      if (key === '+' || key === '=') return zoomBy(1.35);
      if (key === '-') return zoomBy(1 / 1.35);

      const dir = ARROWS[e.key];
      if (!dir) return;
      const nodes = layoutRef.current.nodes;
      e.preventDefault();
      const here = current ? nodes[current] : undefined;
      if (!current || !here) {
        const start = t.homeId && nodes[t.homeId] ? t.homeId : Object.keys(nodes)[0];
        if (start) go(start);
        return;
      }

      const nearest = (ids: string[]): string | undefined =>
        ids
          .filter((id) => nodes[id])
          .sort((a, b) => Math.abs(nodes[a].x - here.x) - Math.abs(nodes[b].x - here.x))[0];
      let target: string | undefined;
      if (dir === 'left' || dir === 'right') {
        // Whoever is next along the same generation, related or not.
        const sign = dir === 'left' ? -1 : 1;
        let best = Infinity;
        for (const id in nodes) {
          const n = nodes[id];
          const d = (n.x - here.x) * sign;
          if (n.y === here.y && d > 0 && d < best) [best, target] = [d, id];
        }
      } else if (dir === 'up') {
        const parents = t.people[current].parentIds;
        const remembered = trail.current.up.get(current);
        target = remembered && parents.includes(remembered) ? remembered : nearest(parents);
        if (target) trail.current.down.set(target, current);
      } else {
        const children = childrenOf(t, current).map((c) => c.id);
        const remembered = trail.current.down.get(current);
        target = remembered && children.includes(remembered) ? remembered : nearest(children);
        if (target) trail.current.up.set(target, current);
      }
      if (target) go(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Export ---------------------------------------------------------------
  // The page only holds what's on screen, so for a picture of the whole tree everything is
  // drawn (in full, whatever the zoom) for as long as the image takes.
  useEffect(() => {
    canvasHandle.exportPng = async () => {
      const { bounds } = layoutRef.current;
      flushSync(() => setExporting(true));
      try {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await downloadTreePng(worldRef.current!, bounds, useStore.getState().tree.name);
      } finally {
        setExporting(false);
      }
    };
    return () => {
      canvasHandle.exportPng = null;
    };
  }, []);

  const onSelect = useCallback((id: string) => select_(id), [select_]);
  const onCompare = useCallback((id: string) => compare(id), [compare]);
  const onEdit = useCallback((id: string) => openDialog({ type: 'edit', personId: id }), [openDialog]);
  const onAdd = useCallback((relation: Relation, id: string) => addRelative(relation, id), []);

  // The selected person's direct line (ancestors and descendants) is drawn again on top, highlighted.
  const litLinks = useMemo(
    () => (lineage ? layout.links.filter((l) => lineage.has(l.childId) && l.parentIds.some((p) => lineage.has(p))) : []),
    [layout, lineage],
  );
  // …and the chain to "me" on top of that, stronger still.
  const pathLinks = useMemo(() => (path ? layout.links.filter((l) => path.childLinks.has(l.childId)) : []), [layout, path]);
  const pathUnions = useMemo(
    () => (path ? layout.unions.filter((u) => path.unions.has(pairKey(u.a, u.b))) : []),
    [layout, path],
  );
  const home = tree.homeId ? tree.people[tree.homeId] : undefined;

  // --- Connector lines ----------------------------------------------------------
  // Lines take the colour of the side of the family they belong to; couples' lines are
  // drawn by status. Resting on a line lights up the people it joins and says who they are.
  const toneOf = useCallback(
    (id: string) => (sideColours ? sides.byKey.get(sides.sideOf.get(id) ?? '')?.tone : undefined),
    [sideColours, sides],
  );
  const families = useMemo(() => {
    const out: Families = new Map();
    for (const l of layout.links) {
      const key = familyKey(l.parentIds);
      let fam = out.get(key);
      if (!fam) out.set(key, (fam = { parents: l.parentIds, children: [] }));
      fam.children.push(l.childId);
    }
    return out;
  }, [layout]);
  const unionById = useMemo(() => new Map(layout.unions.map((u) => [u.id, u])), [layout]);
  const lineData = useRef({ families, unionById });
  lineData.current = { families, unionById };

  /** Resting on, moving along, or tapping one of the wide invisible strokes over a line. */
  const lineEvents = useMemo(() => {
    const targetOf = (e: React.PointerEvent | React.MouseEvent): LineTarget | null => {
      const el = (e.target as Element).closest<SVGElement>('[data-line]');
      if (!el) return null;
      const [kind, key] = [el.dataset.line!, el.dataset.key!];
      return kind === 'union' ? { kind: 'union', id: key } : { kind: 'family', key };
    };
    const show = (target: LineTarget, e: React.PointerEvent | React.MouseEvent, pinned: boolean) => {
      const { families: fams, unionById: unions } = lineData.current;
      let ids: Set<string>;
      if (target.kind === 'union') {
        const u = unions.get(target.id);
        if (!u) return;
        ids = new Set([u.a, u.b]);
      } else {
        const fam = fams.get(target.key);
        if (!fam) return;
        ids = new Set([...fam.parents, ...fam.children]);
      }
      const box = viewportRef.current!.getBoundingClientRect();
      lineHover.set({ ...target, x: e.clientX - box.left, y: e.clientY - box.top, pinned, ids });
    };
    return {
      onPointerOver: (e: React.PointerEvent) => {
        if (e.buttons) return; // panning across lines
        const target = targetOf(e);
        if (target) show(target, e, false);
      },
      onPointerMove: (e: React.PointerEvent) => {
        const cur = lineHover.get();
        if (!cur || cur.pinned || e.buttons) return;
        const box = viewportRef.current!.getBoundingClientRect();
        lineHover.set({ ...cur, x: e.clientX - box.left, y: e.clientY - box.top });
      },
      onPointerOut: () => {
        if (!lineHover.get()?.pinned) lineHover.set(null);
      },
      // A tap (or click) keeps the card up - the only way to read it on a touch screen.
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        const target = targetOf(e);
        if (target) show(target, e, true);
      },
    };
  }, []);

  return (
    <div
      ref={viewportRef}
      className="viewport"
      data-zoom={drawFar ? 'far' : 'near'}
      onPointerOver={(e) => {
        const bridge = (e.target as Element).closest<HTMLElement>('.bridge[data-line]');
        if (bridge) lightLine(bridge.dataset.line!);
      }}
      onPointerOut={(e) => {
        const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest('.bridge[data-line]') : null;
        if ((e.target as Element).closest('.bridge[data-line]') && !to) lightLine(null);
      }}
      onClick={(e) => {
        if (lineHover.get()) lineHover.set(null);
        if (!(e.target as HTMLElement).closest('.card-slot, .canvas-controls, .sides, .line-head')) select_(null);
      }}
    >
      <svg ref={threadsRef} className="deck-threads" aria-hidden="true">
        {deck.flatMap((card) =>
          card.via.map((id) => (
            <g key={`${card.line}:${id}`} data-line={card.line} data-via={id}>
              <path />
              <circle r={3.5} />
            </g>
          )),
        )}
      </svg>

      {/* The canvas is the card in front of the deck: it's what flies when families swap. */}
      <div ref={planeRef} className="plane">
        <div ref={worldRef} className={`world${peeked ? ' is-peeking' : ''}`}>
          {/* Colours come from `currentColor` and shapes from attributes (not CSS classes) so
              the lines survive being cloned for image export. */}
          <svg className="links" width="1" height="1" aria-hidden="true" {...STROKE}>
            {layout.links.map(
              (l) =>
                inWin(drawWin, l.box) && (
                  <path
                    key={l.childId}
                    className={isFreshNode(l.childId) ? 'child-link is-fresh' : 'child-link'}
                    d={l.d}
                    data-tone={toneOf(l.parentIds[0])}
                  />
                ),
            )}
            {/* Couples on top of the lines to their children, a little heavier so a partner
                line never reads as a parent line. */}
            {layout.unions.map(
              (u) =>
                inWin(drawWin, u.box) && (
                  <path
                    key={u.id}
                    className={isFreshUnion(u.id) ? 'union-line is-fresh' : 'union-line'}
                    d={u.d}
                    data-tone={toneOf(u.a)}
                    strokeWidth={2.6}
                    strokeDasharray={UNION_DASH[u.status]}
                  />
                ),
            )}
            {layout.unions.map(
              (u) =>
                inWin(drawWin, u.box) && (
                  <circle
                    key={`ring-${u.id}`}
                    className={isFreshUnion(u.id) ? 'union-ring is-fresh' : 'union-ring'}
                    cx={u.midX}
                    cy={u.midY}
                    r={UNION_RING}
                    data-tone={toneOf(u.a)}
                  />
                ),
            )}
            {/* A folded branch leaves a short stub, so the line visibly leads somewhere. */}
            {toggles.map(
              (t) =>
                t.collapsed &&
                inWin(drawWin, t.box) && (
                  <path
                    key={t.key}
                    className={freshToggles?.has(t.key) && freshNow ? 'branch-stub is-fresh' : 'branch-stub'}
                    d={`M ${t.x} ${t.from} L ${t.x} ${t.y}`}
                  />
                ),
            )}
          </svg>
          <svg
            className="links links-lit"
            width="1"
            height="1"
            aria-hidden="true"
            data-no-export=""
            {...STROKE}
            strokeWidth={2.6}
          >
            <g className={path ? 'lit-lineage is-secondary' : 'lit-lineage'}>
              {litLinks.map((l) => inWin(drawWin, l.box) && <path key={l.childId} className="child-link" d={l.d} />)}
            </g>
            <g className="lit-path" strokeWidth={3.4}>
              {pathUnions.map((u) => (
                <path key={u.id} className="union-line" d={u.d} />
              ))}
              {pathLinks.map((l) => (
                <path key={l.childId} className="child-link" d={l.d} />
              ))}
              {pathUnions.map((u) => (
                <circle key={`ring-${u.id}`} className="union-ring" cx={u.midX} cy={u.midY} r={UNION_RING} />
              ))}
            </g>
          </svg>
          <HoverLines layout={layout} families={families} unionById={unionById} toneOf={toneOf} />
          {/* Wide invisible strokes over every line, so a line is easy to rest on. Under the
              cards, so they still get the clicks. */}
          <svg
            className="links links-hit"
            width="1"
            height="1"
            aria-hidden="true"
            data-no-export=""
            fill="none"
            {...lineEvents}
          >
            {layout.links.map(
              (l) =>
                inWin(drawWin, l.box) && (
                  <path key={l.childId} d={l.d} data-line="family" data-key={familyKey(l.parentIds)} />
                ),
            )}
            {layout.unions.map(
              (u) => inWin(drawWin, u.box) && <path key={u.id} d={u.d} data-line="union" data-key={u.id} />,
            )}
          </svg>

          <Cards
            tree={tree}
            nameStyle={nameStyle}
            layout={layout}
            win={drawWin}
            far={drawFar}
            selectedId={selectedId}
            compareId={compareId}
            pathCards={path?.cards ?? null}
            kin={kin}
            sides={sideColours ? sides : null}
            peeked={peeked}
            placeholders={placeholders}
            isFresh={isFreshNode}
            bridges={bridges}
            onBridge={onBridge}
            onSelect={onSelect}
            onCompare={onCompare}
            onEdit={onEdit}
            onAdd={onAdd}
          />

          {toggles.map(
            (t) =>
              inWin(drawWin, t.box) && (
                <div key={t.key} className="branch-slot" style={{ transform: `translate(${t.x}px, ${t.y}px)` }}>
                  <button
                    type="button"
                    className={`branch-toggle is-${t.kind}${t.collapsed ? ' is-collapsed' : ''}${freshToggles?.has(t.key) && freshNow ? ' is-fresh' : ''}`}
                    // Folded branches stay marked in an exported image; the fold buttons themselves don't.
                    data-no-export={t.collapsed ? undefined : ''}
                    data-tip={`${t.collapsed ? 'Show' : 'Hide'} ${countPeople(t.count)}`}
                    aria-label={t.label}
                    aria-expanded={!t.collapsed}
                    onClick={(e) => {
                      e.stopPropagation();
                      foldedAt.current = t.ids[0];
                      toggleCollapse(t.key);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {t.collapsed ? `+${t.count}` : <Minus size={10} strokeWidth={3.2} />}
                  </button>
                </div>
              ),
          )}

        </div>
      </div>

      {byLine && line && (
        <div className="line-head">
          <FamilyBar
            tree={tree}
            trail={trailOf(tree, lines)}
            linked={deck}
            onGo={(to, via) => {
              foldedAt.current = via;
              showLine(to, via);
            }}
            onLinked={onDeck}
            onHot={lightLine}
            onWholeTree={() => useStore.getState().setLines(false)}
          />
        </div>
      )}

      <HoverTip tree={tree} layout={layout} families={families} unionById={unionById} toneOf={toneOf} viewportRef={viewportRef} />

      {total > 0 && (
        <div className="canvas-controls">
          <SidesLegend />
          <div className="control-group">
            <button type="button" className="icon-btn zoom-step" onClick={() => zoomBy(1 / 1.35)} data-tip="Zoom out (−)" aria-label="Zoom out">
              <Minus size={17} />
            </button>
            <button type="button" className="icon-btn zoom-step" onClick={() => zoomBy(1.35)} data-tip="Zoom in (+)" aria-label="Zoom in">
              <Plus size={17} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => useStore.getState().fitView()}
              data-tip={byLine ? 'Fit (F)' : 'Fit whole tree (F)'}
              aria-label={byLine ? 'Fit the family in view' : 'Fit whole tree'}
            >
              <Maximize size={16} />
            </button>
            {home && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => useStore.getState().goHome()}
                data-tip={`Go to ${shortName(home)} (H)`}
                aria-label={`Go to ${shortName(home)}, the home person`}
              >
                <House size={16} />
              </button>
            )}
            <span className="control-sep" aria-hidden="true" />
            <button
              type="button"
              className="icon-btn"
              onClick={() => useStore.getState().setLines(!lines.on)}
              data-tip={lines.on ? 'Whole tree' : 'One family at a time'}
              aria-label={lines.on ? 'Show the whole tree' : 'Show one family at a time'}
            >
              {lines.on ? <Network size={16} /> : <UsersRound size={16} />}
            </button>
          </div>
          {hiddenCount > 0 && !focus && !byLine ? (
            <button
              type="button"
              className="stats-pill is-filtered"
              onClick={() => useStore.getState().showAll()}
              data-tip="Unfold every collapsed branch"
            >
              <EyeOff size={13} />
              {visible.size} of {countPeople(total)}
              <strong>Show all</strong>
            </button>
          ) : (
            <button
              type="button"
              className="stats-pill is-link"
              data-tip="The family in numbers"
              onClick={() => useStore.getState().openDialog({ type: 'insights', tab: 'family' })}
            >
              {byLine
                ? words.people(visible.size)
                : hiddenCount > 0
                  ? `${num(visible.size)} / ${words.people(total)}`
                  : words.people(total)}{' '}
              · {words.generations(layout.generations)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface CardsProps {
  tree: Tree;
  nameStyle: unknown;
  layout: TreeLayout;
  win: Win | null;
  far: boolean;
  selectedId: string | null;
  compareId: string | null;
  pathCards: ReadonlySet<string> | null;
  kin: Map<string, string>;
  sides: ReturnType<typeof familySides> | null;
  peeked: ReadonlySet<string> | null;
  placeholders: ReadonlySet<string>;
  isFresh: (id: string) => boolean;
  bridges: Map<string, Bridge>;
  onBridge: (id: string) => void;
  onSelect: (id: string) => void;
  onCompare: (id: string) => void;
  onEdit: (id: string) => void;
  onAdd: (relation: Relation, id: string) => void;
}

/** The cards on screen (and whoever is selected or compared, wherever they are). */
function Cards({
  tree,
  nameStyle,
  layout,
  win,
  far,
  selectedId,
  compareId,
  pathCards,
  kin,
  sides,
  peeked,
  placeholders,
  isFresh,
  bridges,
  onBridge,
  onSelect,
  onCompare,
  onEdit,
  onAdd,
}: CardsProps) {
  const out = [];
  for (const id in layout.nodes) {
    const pos = layout.nodes[id];
    const p = tree.people[id];
    if (!p) continue;
    if (id !== selectedId && id !== compareId && !inWin(win, cardBox(pos.x, pos.y))) continue;
    const side = sides?.byKey.get(sides.sideOf.get(id) ?? '');
    const bridge = bridges.get(id);
    out.push(
      <PersonCard
        key={id}
        person={p}
        fullName={fullName(tree, p)}
        x={pos.x}
        y={pos.y}
        selected={id === selectedId}
        compared={id === compareId}
        onPath={Boolean(pathCards?.has(id)) && id !== selectedId}
        isHome={id === tree.homeId}
        placeholder={placeholders.has(id)}
        relation={kin.get(id) ?? ''}
        tone={side ? side.tone : null}
        dimmed={peeked !== null && !peeked.has(id)}
        far={far}
        fresh={isFresh(id)}
        canAddParent={p.parentIds.length < 2 || p.parentIds.some((pid) => placeholders.has(pid))}
        bridge={bridge ?? null}
        onBridge={onBridge}
        nameStyle={nameStyle}
        onSelect={onSelect}
        onCompare={onCompare}
        onEdit={onEdit}
        onAdd={onAdd}
      />,
    );
  }
  return out;
}

interface HoverProps {
  layout: TreeLayout;
  families: Families;
  unionById: Map<string, UnionLine>;
  toneOf: (id: string) => number | undefined;
}

/** What the line being rested on stands for, and the lines to draw over it. */
function hoveredLine(target: LineTarget, { layout, families, unionById, toneOf }: HoverProps) {
  if (target.kind === 'union') {
    const u = unionById.get(target.id);
    if (!u) return null;
    const children = families.get(familyKey([u.a, u.b]))?.children.length ?? 0;
    const connector: Connector = { kind: 'union', a: u.a, b: u.b, status: u.status, children };
    return { connector, tone: toneOf(u.a), unions: [u], links: [] as ChildLink[] };
  }
  const fam = families.get(target.key);
  if (!fam) return null;
  const u = fam.parents.length === 2 ? layout.unionByPair.get(pairKey(fam.parents[0], fam.parents[1])) : undefined;
  const connector: Connector = { kind: 'family', parents: fam.parents, children: fam.children };
  return { connector, tone: toneOf(fam.parents[0]), unions: u ? [u] : [], links: [] as ChildLink[] };
}

/** The line being rested on, drawn heavier - re-rendered on its own, not with the canvas. */
const HoverLines = memo(function HoverLines(props: HoverProps) {
  const hover = useLineHover();
  const targetKey = hover ? (hover.kind === 'union' ? `u:${hover.id}` : `f:${hover.key}`) : null;
  const { layout, families, unionById, toneOf } = props;
  const hovered = useMemo(() => {
    if (!hover) return null;
    const h = hoveredLine(hover, { layout, families, unionById, toneOf });
    if (h && hover.kind === 'family') h.links = layout.links.filter((l) => familyKey(l.parentIds) === hover.key);
    return h;
    // Only which line it is matters here, not where along it the pointer is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, layout, families, unionById, toneOf]);
  if (!hovered) return null;
  return (
    <svg className="links links-hover" width="1" height="1" aria-hidden="true" data-no-export="" {...STROKE} strokeWidth={4}>
      <g data-tone={hovered.tone}>
        {hovered.links.map((l) => (
          <path key={l.childId} className="child-link" d={l.d} />
        ))}
        {hovered.unions.map((u) => (
          <path key={u.id} className="union-line" d={u.d} strokeDasharray={UNION_DASH[u.status]} />
        ))}
        {hovered.unions.map((u) => (
          <circle key={`ring-${u.id}`} className="union-ring" cx={u.midX} cy={u.midY} r={UNION_RING + 1} />
        ))}
      </g>
    </svg>
  );
});

/** The card saying who a line joins, beside the pointer. */
function HoverTip({ tree, viewportRef, ...props }: HoverProps & { tree: Tree; viewportRef: React.RefObject<HTMLDivElement | null> }) {
  const hover = useLineHover();
  if (!hover) return null;
  const hovered = hoveredLine(hover, props);
  if (!hovered) return null;
  // Keep the card on screen: it flips to the other side of the pointer near the edges.
  const vp = viewportRef.current;
  const w = vp?.clientWidth ?? 0;
  const h = vp?.clientHeight ?? 0;
  const left = hover.x > w - 300 ? undefined : hover.x + 16;
  const right = left === undefined ? w - hover.x + 16 : undefined;
  const top = hover.y > h - 220 ? undefined : hover.y + 18;
  const bottom = top === undefined ? h - hover.y + 14 : undefined;
  return (
    <div className={`ctip${hover.pinned ? ' is-pinned' : ''}`} role="status" style={{ left, right, top, bottom }} data-tone={hovered.tone}>
      <ConnectorTip tree={tree} connector={hovered.connector} />
    </div>
  );
}
