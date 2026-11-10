import { useCallback, useEffect, useMemo, useRef } from 'react';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { EyeOff, House, Maximize, Minus, Plus } from 'lucide-react';
import type { Relation } from '../types';
import { useStore } from '../store';
import {
  CARD_H,
  CARD_W,
  TOGGLE_GAP,
  UNION_RING,
  computeLayout,
  familyStem,
  type LayoutAnchor,
  type TreeLayout,
} from '../lib/layout';
import { branchToggles, subTree, visibleIds } from '../lib/branches';
import { kinshipFor } from '../lib/kinship';
import { ancestorIds, childrenOf, descendantIds, isPlaceholder, pathBetween, shortName } from '../lib/tree';
import { addRelative } from '../lib/actions';
import { downloadTreePng } from '../lib/files';
import { canvasHandle } from '../lib/canvasHandle';
import { PersonCard } from './PersonCard';

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
const countPeople = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;
const TOP_INSET = 76;

export function Canvas() {
  const tree = useStore((s) => s.tree);
  const selectedId = useStore((s) => s.selectedId);
  const compareId = useStore((s) => s.compareId);
  const focusId = useStore((s) => s.focusId);
  const collapsed = useStore((s) => s.collapsed);
  const view = useStore((s) => s.view);
  const select_ = useStore((s) => s.select);
  const compare = useStore((s) => s.compare);
  const openDialog = useStore((s) => s.openDialog);
  const toggleCollapse = useStore((s) => s.toggleCollapse);

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);

  // Only the people on show are laid out: a focused branch, or the tree minus its folded
  // branches. Everything drawn below works from `shown`, never from the full tree.
  const visible = useMemo(() => visibleIds(tree, focusId, collapsed), [tree, focusId, collapsed]);
  const shown = useMemo(() => subTree(tree, visible), [tree, visible]);
  const total = Object.keys(tree.people).length;
  const hiddenCount = total - visible.size;

  // Keep whoever the user is looking at pinned in place when the tree changes — or, when a
  // branch is folded, the card it was folded at.
  const previous = useRef<{ layout: TreeLayout; selectedId: string | null; focusId: string | null } | null>(null);
  const foldedAt = useRef<string | null>(null);
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
  }, [shown]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    previous.current = { layout, selectedId, focusId };
    foldedAt.current = null;
  });

  const kin = kinshipFor(tree);

  const lineage = useMemo(() => {
    if (!selectedId || !shown.people[selectedId]) return null;
    return new Set([selectedId, ...ancestorIds(shown, selectedId), ...descendantIds(shown, selectedId)]);
  }, [shown, selectedId]);

  // The chain of people between the selected person and "me" (or whoever they're being
  // compared with) — it's what makes a label like "Cousin once removed" make sense.
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
      return [{ ...t, x, y, from, label }];
    });
  }, [tree, collapsed, focusId, layout]);

  const placeholders = useMemo(
    () => new Set(Object.values(tree.people).filter(isPlaceholder).map((p) => p.id)),
    [tree],
  );

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
        return !(e.target as HTMLElement).closest('.quick-add, .branch-toggle, .canvas-controls');
      })
      .on('zoom', (event: { transform: ZoomTransform }) => {
        const t = event.transform;
        world.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
        let grid = 28 * t.k;
        while (grid < 16) grid *= 2;
        viewport.style.backgroundSize = `${grid}px ${grid}px`;
        viewport.style.backgroundPosition = `${t.x}px ${t.y}px`;
      });
    zoomRef.current = behavior;
    select(viewport).call(behavior).on('dblclick.zoom', null);
    return () => {
      select(viewport).on('.zoom', null);
    };
  }, []);

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
    else select(viewport).call(behavior.transform, t);
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
        target = Object.keys(nodes)
          .filter((id) => nodes[id].y === here.y && (nodes[id].x - here.x) * sign > 0)
          .sort((a, b) => (nodes[a].x - nodes[b].x) * sign)[0];
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
  useEffect(() => {
    canvasHandle.exportPng = async () => {
      const { bounds } = layoutRef.current;
      await downloadTreePng(worldRef.current!, bounds, useStore.getState().tree.name);
    };
    return () => {
      canvasHandle.exportPng = null;
    };
  }, []);

  const onSelect = useCallback((id: string) => select_(id), [select_]);
  const onCompare = useCallback((id: string) => compare(id), [compare]);
  const onEdit = useCallback((id: string) => openDialog({ type: 'edit', personId: id }), [openDialog]);
  const onAdd = useCallback((relation: Relation, id: string) => addRelative(relation, id), []);

  const people = Object.values(tree.people);
  // The selected person's direct line (ancestors and descendants) is drawn again on top, highlighted.
  const litLinks = lineage
    ? layout.links.filter((l) => lineage.has(l.childId) && l.parentIds.some((p) => lineage.has(p)))
    : [];
  // …and the chain to "me" on top of that, stronger still.
  const pathLinks = path ? layout.links.filter((l) => path.childLinks.has(l.childId)) : [];
  const pathUnions = path ? layout.unions.filter((u) => path.unions.has(pairKey(u.a, u.b))) : [];
  const home = tree.homeId ? tree.people[tree.homeId] : undefined;

  return (
    <div
      ref={viewportRef}
      className="viewport"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('.card-slot, .canvas-controls')) select_(null);
      }}
    >
      <div ref={worldRef} className="world">
        {/* Colours come from `currentColor` and shapes from attributes (not CSS classes) so
            the lines survive being cloned for image export. */}
        <svg className="links" width="1" height="1" aria-hidden="true" {...STROKE}>
          {layout.unions.map((u) => (
            <path
              key={u.id}
              className="union-line"
              d={u.d}
              strokeDasharray={u.status === 'divorced' ? '2 7' : undefined}
            />
          ))}
          {layout.links.map((l) => (
            <path key={l.childId} className="child-link" d={l.d} />
          ))}
          {layout.unions.map((u) => (
            <circle key={`ring-${u.id}`} className="union-ring" cx={u.midX} cy={u.midY} r={UNION_RING} />
          ))}
          {/* A folded branch leaves a short stub, so the line visibly leads somewhere. */}
          {toggles
            .filter((t) => t.collapsed)
            .map((t) => (
              <path key={t.key} className="branch-stub" d={`M ${t.x} ${t.from} L ${t.x} ${t.y}`} />
            ))}
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
            {litLinks.map((l) => (
              <path key={l.childId} className="child-link" d={l.d} />
            ))}
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

        {people.map((p) => {
          const pos = layout.nodes[p.id];
          if (!pos) return null;
          return (
            <PersonCard
              key={p.id}
              person={p}
              x={pos.x}
              y={pos.y}
              selected={p.id === selectedId}
              compared={p.id === compareId}
              onPath={Boolean(path?.cards.has(p.id)) && p.id !== selectedId}
              isHome={p.id === tree.homeId}
              placeholder={placeholders.has(p.id)}
              relation={kin.get(p.id) ?? ''}
              canAddParent={p.parentIds.length < 2 || p.parentIds.some((id) => placeholders.has(id))}
              onSelect={onSelect}
              onCompare={onCompare}
              onEdit={onEdit}
              onAdd={onAdd}
            />
          );
        })}

        {toggles.map((t) => (
          <div key={t.key} className="branch-slot" style={{ transform: `translate(${t.x}px, ${t.y}px)` }}>
            <button
              type="button"
              className={`branch-toggle is-${t.kind}${t.collapsed ? ' is-collapsed' : ''}`}
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
        ))}
      </div>

      {people.length > 0 && (
        <div className="canvas-controls">
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
          {hiddenCount > 0 && !focusId ? (
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
