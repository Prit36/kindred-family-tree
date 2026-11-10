import { useCallback, useEffect, useMemo, useRef } from 'react';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { Relation } from '../types';
import { useStore } from '../store';
import { CARD_H, CARD_W, UNION_RING, computeLayout, type LayoutAnchor, type TreeLayout } from '../lib/layout';
import { kinshipFor } from '../lib/kinship';
import { ancestorIds, descendantIds } from '../lib/tree';
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

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;
const TOP_INSET = 76;

export function Canvas() {
  const tree = useStore((s) => s.tree);
  const selectedId = useStore((s) => s.selectedId);
  const view = useStore((s) => s.view);
  const select_ = useStore((s) => s.select);
  const openDialog = useStore((s) => s.openDialog);

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);

  // Keep whoever the user is looking at pinned in place when the tree changes.
  const previous = useRef<{ layout: TreeLayout; selectedId: string | null } | null>(null);
  const layout = useMemo(() => {
    const prev = previous.current;
    let anchor: LayoutAnchor | undefined;
    if (prev) {
      const usable = (id: string | null | undefined): id is string =>
        Boolean(id && prev.layout.nodes[id] && tree.people[id]);
      const id =
        [selectedId, prev.selectedId, tree.homeId].find(usable) ?? Object.keys(prev.layout.nodes).find(usable);
      if (id) anchor = { id, ...prev.layout.nodes[id] };
    }
    return computeLayout(tree, anchor);
    // selectedId is read on purpose without being a dependency: only tree changes re-layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    previous.current = { layout, selectedId };
  });

  const kin = kinshipFor(tree);

  const lineage = useMemo(() => {
    if (!selectedId || !tree.people[selectedId]) return null;
    return new Set([selectedId, ...ancestorIds(tree, selectedId), ...descendantIds(tree, selectedId)]);
  }, [tree, selectedId]);

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
        return !(e.target as HTMLElement).closest('.quick-add, .canvas-controls');
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
  const onAdd = useCallback(
    (relation: Relation, id: string) => openDialog({ type: 'add', relation, anchorId: id }),
    [openDialog],
  );

  const people = Object.values(tree.people);
  // The selected person's direct line (ancestors and descendants) is drawn again on top, highlighted.
  const litLinks = lineage
    ? layout.links.filter((l) => lineage.has(l.childId) && l.parentIds.some((p) => lineage.has(p)))
    : [];

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
        </svg>
        <svg className="links links-lit" width="1" height="1" aria-hidden="true" {...STROKE} strokeWidth={2.8}>
          {litLinks.map((l) => (
            <path key={l.childId} className="child-link" d={l.d} />
          ))}
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
              isHome={p.id === tree.homeId}
              relation={kin.get(p.id) ?? ''}
              canAddParent={p.parentIds.length < 2}
              onSelect={onSelect}
              onAdd={onAdd}
            />
          );
        })}
      </div>

      {people.length > 0 && (
        <div className="canvas-controls">
          <div className="control-group">
            <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.35)} data-tip="Zoom out" aria-label="Zoom out">
              <Minus size={17} />
            </button>
            <button type="button" className="icon-btn" onClick={() => zoomBy(1.35)} data-tip="Zoom in" aria-label="Zoom in">
              <Plus size={17} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => useStore.getState().fitView()}
              data-tip="Fit whole tree"
              aria-label="Fit whole tree"
            >
              <Maximize size={16} />
            </button>
          </div>
          <div className="stats-pill">
            {people.length} {people.length === 1 ? 'person' : 'people'} · {layout.generations}{' '}
            {layout.generations === 1 ? 'generation' : 'generations'}
          </div>
        </div>
      )}
    </div>
  );
}
