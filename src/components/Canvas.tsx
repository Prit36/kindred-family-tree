import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { EyeOff, House, Maximize, Minus, Plus } from 'lucide-react';
import type { Relation, Tree } from '../types';
import { useStore } from '../store';
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
import { familySides } from '../lib/sides';
import { relationLabels } from '../lib/naming';
import { shapeOf } from '../lib/shape';
import { lineHover, useLineHover, type LineTarget } from '../lib/lineHover';
import { ancestorIds, childrenOf, descendantIds, isPlaceholder, pathBetween, shortName } from '../lib/tree';
import { addRelative } from '../lib/actions';
import { downloadTreePng } from '../lib/files';
import { canvasHandle } from '../lib/canvasHandle';
import { PersonCard } from './PersonCard';
import { SidesLegend } from './SidesLegend';
import { ConnectorTip, type Connector } from './ConnectorTip';
import { Minimap, type MinimapHandle } from './Minimap';

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

const countPeople = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

const MIN_ZOOM = 0.15;
/**
 * Below this zoom names are too small to read, so cards switch to a glance view: the
 * relationship ("Father", "Wife") and first name in large type, on their side's colour.
 */
const FAR_ZOOM = 0.62;
const MAX_ZOOM = 2;
const TOP_INSET = 76;
/** From this many people on show, the overview map appears in the corner. */
const MINIMAP_FROM = 25;
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
  const theme = useStore((s) => s.theme);
  const select_ = useStore((s) => s.select);
  const compare = useStore((s) => s.compare);
  const openDialog = useStore((s) => s.openDialog);
  const toggleCollapse = useStore((s) => s.toggleCollapse);

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const minimapRef = useRef<MinimapHandle>(null);

  // What is drawn: the area around the screen, the zoom level's style of card, and - while
  // an image is being saved - everything, in full.
  const [win, setWin] = useState<Win>({ x0: 0, y0: 0, x1: 0, y1: 0 });
  const winRef = useRef<Win | null>(null);
  const [far, setFar] = useState(false);
  const farRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const drawWin = exporting ? null : win;
  const drawFar = far && !exporting;

  // Only the people on show are laid out: a focused branch, or the tree minus its folded
  // branches. Everything drawn below works from `shown`, never from the full tree.
  const visible = useMemo(() => visibleIds(tree, focus, collapsed), [tree, focus, collapsed]);
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
      const id =
        [foldedAt.current, selectedId, prev.selectedId, prev.focusId, tree.homeId].find(usable) ??
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
  const kin = relationLabels(tree, naming);
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
    if (focusId) return [];
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
  }, [tree, collapsed, focusId, layout]);
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
        return !(e.target as HTMLElement).closest('.quick-add, .branch-toggle, .canvas-controls, .sides, .minimap');
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
        minimapRef.current?.update(t);
      });
    zoomRef.current = behavior;
    select(viewport).call(behavior).on('dblclick.zoom', null);
    syncView(zoomTransform(viewport));
    // A bigger window shows more of the tree.
    const resize = new ResizeObserver(() => {
      const t = zoomTransform(viewport);
      syncView(t);
      minimapRef.current?.update(t);
    });
    resize.observe(viewport);
    return () => {
      resize.disconnect();
      select(viewport).on('.zoom', null);
      lineHover.set(null);
    };
  }, [syncView]);

  /** Screen area not covered by the top bar or the details panel. */
  const visibleArea = useCallback(() => {
    const viewport = viewportRef.current!;
    const left = 0;
    const top = TOP_INSET;
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

  // Respond to "fit", "focus on person" and "make sure person is visible" requests.
  useEffect(() => {
    const viewport = viewportRef.current!;
    const { nodes, bounds } = layoutRef.current;
    const area = visibleArea();
    const animate = view.nonce > 0;

    if (view.kind === 'fit') {
      if (bounds.width === 0) return;
      const margin = 56;
      const k = Math.max(
        MIN_ZOOM,
        Math.min(1, (area.width - margin * 2) / bounds.width, (area.height - margin * 2) / bounds.height),
      );
      // When opening a tree too big to read at "fit" size, start on the home person instead.
      const homeId = useStore.getState().tree.homeId;
      const home = homeId ? nodes[homeId] : undefined;
      if (!animate && k < 0.4 && home) {
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
    const k = current.k < 0.5 ? 0.85 : current.k;
    const x = area.left + area.width / 2 - (pos.x + CARD_W / 2) * k;
    const y = area.top + area.height / 2 - (pos.y + CARD_H / 2) * k;
    moveTo(zoomIdentity.translate(x, y).scale(k), animate);
  }, [view, moveTo, visibleArea]);

  const zoomBy = (factor: number) => {
    const viewport = viewportRef.current!;
    select(viewport).transition().duration(220).call(zoomRef.current!.scaleBy, factor);
  };

  /** The overview map moves the view: the clicked point goes to the middle of the free area. */
  const navigateTo = useCallback(
    (x: number, y: number, animate: boolean) => {
      const area = visibleArea();
      const k = zoomTransform(viewportRef.current!).k;
      const t = zoomIdentity.translate(area.left + area.width / 2 - x * k, area.top + area.height / 2 - y * k).scale(k);
      moveTo(t, animate);
    },
    [moveTo, visibleArea],
  );
  const viewportSize = useCallback(() => {
    const vp = viewportRef.current;
    return { width: vp?.clientWidth ?? 0, height: vp?.clientHeight ?? 0 };
  }, []);

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
      if (key === 'h') return void (t.homeId && go(t.homeId, true));
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

  const showMinimap = visible.size >= MINIMAP_FROM && layout.bounds.width > 0;
  const minimapLit = path?.cards ?? null;

  return (
    <div
      ref={viewportRef}
      className="viewport"
      data-zoom={drawFar ? 'far' : 'near'}
      onClick={(e) => {
        if (lineHover.get()) lineHover.set(null);
        if (!(e.target as HTMLElement).closest('.card-slot, .canvas-controls, .sides, .minimap')) select_(null);
      }}
    >
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

      <HoverTip tree={tree} layout={layout} families={families} unionById={unionById} toneOf={toneOf} viewportRef={viewportRef} />

      {showMinimap && (
        <Minimap
          ref={minimapRef}
          layout={layout}
          toneOf={toneOf}
          selectedId={selectedId}
          homeId={shown.homeId}
          lit={minimapLit}
          theme={theme}
          viewport={viewportSize}
          onNavigate={navigateTo}
        />
      )}

      {total > 0 && (
        <div className="canvas-controls">
          <SidesLegend />
          <div className="control-group">
            <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.35)} data-tip="Zoom out (−)" aria-label="Zoom out">
              <Minus size={17} />
            </button>
            <button type="button" className="icon-btn" onClick={() => zoomBy(1.35)} data-tip="Zoom in (+)" aria-label="Zoom in">
              <Plus size={17} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => useStore.getState().fitView()}
              data-tip="Fit whole tree (F)"
              aria-label="Fit whole tree"
            >
              <Maximize size={16} />
            </button>
            {home && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => select_(home.id, true)}
                data-tip={`Go to ${shortName(home)} (H)`}
                aria-label={`Go to ${shortName(home)}, the home person`}
              >
                <House size={16} />
              </button>
            )}
          </div>
          {hiddenCount > 0 && !focus ? (
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
            <div className="stats-pill">
              {hiddenCount > 0 ? `${visible.size} of ${countPeople(total)}` : countPeople(total)} · {layout.generations}{' '}
              {layout.generations === 1 ? 'generation' : 'generations'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CardsProps {
  tree: Tree;
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
  onSelect: (id: string) => void;
  onCompare: (id: string) => void;
  onEdit: (id: string) => void;
  onAdd: (relation: Relation, id: string) => void;
}

/** The cards on screen (and whoever is selected or compared, wherever they are). */
function Cards({
  tree,
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
    out.push(
      <PersonCard
        key={id}
        person={p}
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
