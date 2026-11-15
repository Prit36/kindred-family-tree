import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { select as d3select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { Check, ChevronDown, HeartHandshake, Maximize, Minus, Plus, Search } from 'lucide-react';
import type { Person, Tree } from '../types';
import { useStore } from '../store';
import { canvasHandle } from '../lib/canvasHandle';
import { formatDate, lifespan } from '../lib/dates';
import {
  ROOT_R,
  branchBox,
  descendantCount,
  fanLayout,
  generationName,
  isNameless,
  largestFamilies,
  latePrefix,
  patriarchOf,
  ringLabelSpots,
  sliceCentre,
  standInName,
  treeName,
  type FanLayout,
  type FanNode,
} from '../lib/fan';
import { downloadFanPng, type FanPicture } from '../lib/fanExport';
import { relationLabels, relationName, type Naming } from '../lib/naming';
import { searchIndex, searchPeople } from '../lib/search';
import { SIDE_TONES } from '../lib/sides';
import { displayName, fullName, indexOf, partnersOf, shortName } from '../lib/tree';
import { Avatar } from './Avatar';

const MIN_ZOOM = 0.04;
const MAX_ZOOM = 4;
/** Labels smaller than this on screen are left out until you zoom in on them. */
const READABLE_PX = 8.5;
const TIP_DELAY = 160;

/** Inner rings take a stronger wash of their branch's colour than the outer ones. */
const MIX = [0, 44, 34, 27, 22, 18, 15];
const mixFor = (depth: number) => MIX[Math.min(depth, MIX.length - 1)];

type Box = { minX: number; minY: number; width: number; height: number };

/** "5 generations · 27 descendants · 18 living", in the words relationships are named in. */
function statsText(gens: number, count: number, living: number, naming: Naming): string {
  if (naming === 'gu') return `${gens} પેઢી · ${count} વંશજ · ${living} હયાત`;
  if (naming === 'gu-latn') return `${gens} pedhi · ${count} vanshaj · ${living} hayat`;
  return `${gens} ${gens === 1 ? 'generation' : 'generations'} · ${count} ${count === 1 ? 'descendant' : 'descendants'} · ${living} living`;
}

function descendantsText(n: number, naming: Naming): string {
  if (naming === 'gu') return `${n} વંશજ`;
  if (naming === 'gu-latn') return `${n} vanshaj`;
  return `${n} ${n === 1 ? 'descendant' : 'descendants'}`;
}

/** Who the fan is of when nobody has been picked: the head of your father's line, else the biggest family. */
function defaultRoot(tree: Tree): string | null {
  const { children } = indexOf(tree);
  const start = tree.homeId && tree.people[tree.homeId] ? tree.homeId : null;
  if (start) {
    const top = patriarchOf(tree, start);
    if (children.get(top)?.length) return top;
  }
  return largestFamilies(tree, 1)[0]?.id ?? start ?? Object.keys(tree.people)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Choosing whose family to show
// ---------------------------------------------------------------------------

function RootPicker({ tree, root, kin, naming }: { tree: Tree; root: Person; kin: Map<string, string>; naming: Naming }) {
  const setFan = useStore((s) => s.setFan);
  const selectedId = useStore((s) => s.selectedId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const families = useMemo(() => (open ? largestFamilies(tree, 8) : []), [open, tree]);
  const index = useMemo(() => (open && query.trim() ? searchIndex(tree) : []), [open, query, tree]);
  const { children } = indexOf(tree);
  const options = useMemo(() => {
    if (query.trim()) {
      // People with a family of their own first: they're the ones worth a tree.
      return searchPeople(index, query, 30)
        .map(({ person }, i) => ({ person, count: descendantCount(tree, person.id) as number | null, i }))
        .sort((a, b) => Number(b.count! > 0) - Number(a.count! > 0) || a.i - b.i);
    }
    const list = families.map(({ id, count }) => ({ person: tree.people[id], count: count as number | null }));
    // Whoever is selected, if they have a family of their own and aren't listed already.
    const sel = selectedId ? tree.people[selectedId] : undefined;
    if (sel && children.get(sel.id)?.length && !list.some((o) => o.person.id === sel.id))
      list.unshift({ person: sel, count: descendantCount(tree, sel.id) });
    return list;
  }, [query, index, families, tree, selectedId, children]);

  const choose = (id: string) => {
    setFan({ rootId: id });
    setOpen(false);
    setQuery('');
  };

  const relation = kin.get(root.id);
  return (
    <div className="fan-picker" ref={ref}>
      <button
        type="button"
        className="fan-picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-tip={open ? undefined : 'Whose family to show'}
        onClick={() => {
          setOpen((o) => !o);
          setActive(0);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <Avatar person={root} size={28} />
        <span className="fan-picker-name">{treeName(tree, root, naming)}</span>
        {relation && <span className="fan-picker-rel">{relation}</span>}
        <ChevronDown size={15} className="fan-picker-chev" />
      </button>
      {open && (
        <div className="fan-picker-pop" role="dialog" aria-label="Whose family to show">
          <div className="fan-picker-search">
            <Search size={15} />
            <input
              ref={inputRef}
              value={query}
              placeholder="Find someone…"
              aria-label="Find someone"
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, options.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter' && options[active]) {
                  choose(options[active].person.id);
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
            />
          </div>
          {!query.trim() && options.length > 0 && <h3 className="fan-picker-heading">Largest families</h3>}
          <ul className="fan-picker-list" role="listbox">
            {options.length === 0 && <li className="search-empty">No one by that name</li>}
            {options.map(({ person: p, count }, i) => (
              <li key={p.id} role="option" aria-selected={p.id === root.id}>
                <button
                  type="button"
                  className={`search-result${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p.id)}
                >
                  <Avatar person={p} size={30} />
                  <span className="rel-text">
                    <span className="rel-name">{standInName(tree, p, naming) || fullName(tree, p)}</span>
                    <span className="rel-sub">
                      {[kin.get(p.id), lifespan(p), count ? descendantsText(count, naming) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {p.id === root.id && <Check size={16} className="fan-picker-check" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** The trunk, its roots and the ground, below the root person's disc. */
const Trunk = memo(function Trunk({ groundY }: { groundY: number }) {
  const top = ROOT_R * 0.3;
  const g = groundY;
  const h = g - top;
  const trunk =
    `M-30 ${top}` +
    `C-31 ${top + h * 0.45} -36 ${g - h * 0.25} -62 ${g}` +
    `Q-36 ${g - 8} -16 ${g + 2}` +
    `Q0 ${g - 6} 16 ${g + 2}` +
    `Q36 ${g - 8} 62 ${g}` +
    `C36 ${g - h * 0.25} 31 ${top + h * 0.45} 30 ${top}Z`;
  return (
    <g className="fan-trunk" aria-hidden="true">
      <ellipse className="fan-ground" cx="0" cy={g + 2} rx="230" ry="16" />
      <path className="fan-root-line" d={`M-58 ${g}C-90 ${g + 4} -120 ${g + 12} -158 ${g + 10}`} />
      <path className="fan-root-line" d={`M-24 ${g + 1}C-36 ${g + 10} -52 ${g + 20} -80 ${g + 26}`} />
      <path className="fan-root-line" d={`M58 ${g}C90 ${g + 4} 120 ${g + 12} 158 ${g + 10}`} />
      <path className="fan-root-line" d={`M24 ${g + 1}C36 ${g + 10} 52 ${g + 20} 80 ${g + 26}`} />
      <path className="fan-bark" d={trunk} />
      <path className="fan-bark-grain" d={`M-10 ${top + h * 0.2}C-12 ${top + h * 0.5} -14 ${g - h * 0.2} -26 ${g - 4}`} />
      <path className="fan-bark-grain" d={`M8 ${top + h * 0.35}C10 ${top + h * 0.6} 12 ${g - h * 0.15} 20 ${g - 6}`} />
    </g>
  );
});

interface LayerProps {
  fan: FanLayout;
  lit: ReadonlySet<number> | null;
  line: ReadonlySet<number>;
  selIdx: number;
  cmpIdx: number;
  homeIdx: number;
}

/** Branches from each parent's slice out to their children's. */
const Twigs = memo(function Twigs({ fan, lit, line }: LayerProps) {
  const on = (i: number) => (lit ? lit.has(i) : line.has(i));
  const nodes = fan.nodes.slice(1);
  // Lit branches go on top so they read as one line through the canopy.
  const order = [...nodes.filter((n) => !on(fan.index.get(n.id)!)), ...nodes.filter((n) => on(fan.index.get(n.id)!))];
  return (
    <g className="fan-twigs" aria-hidden="true">
      {order.map((n) => {
        const i = fan.index.get(n.id)!;
        const isOn = on(i);
        return (
          <path
            key={n.id}
            d={n.twig}
            className={`fan-twig${n.depth === 1 ? ' is-bough' : ''}${isOn ? ' is-lit' : ''}${lit && !isOn ? ' is-dim' : ''}`}
            data-tone={isOn ? n.branch % SIDE_TONES : undefined}
            strokeWidth={n.twigWidth}
          />
        );
      })}
    </g>
  );
});

const Slices = memo(function Slices({ fan, lit, line, selIdx, cmpIdx, homeIdx }: LayerProps) {
  return (
    <g className="fan-slices">
      {fan.nodes.map((n, i) => {
        if (n.depth === 0) return null;
        const cls = [
          'fan-slice',
          n.viaDaughter ? 'is-daughter-line' : '',
          i === selIdx ? 'is-selected' : '',
          i === cmpIdx ? 'is-compared' : '',
          i === homeIdx ? 'is-home' : '',
          line.has(i) && i !== selIdx ? 'is-on-line' : '',
          lit ? (lit.has(i) ? 'is-lit' : 'is-dim') : '',
          n.person.deceased || n.person.deathDate ? 'is-deceased' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <g key={n.id} className={cls} data-tone={n.branch % SIDE_TONES} style={{ ['--mix' as string]: `${mixFor(n.depth)}%` }}>
            <path d={n.d} data-i={i} />
            {n.viaDaughter && <path d={n.d} className="fan-hatch" fill={`url(#fan-hatch-${n.branch % SIDE_TONES})`} />}
          </g>
        );
      })}
    </g>
  );
});

/** Names, grouped by size so zooming can show or hide each group at once. */
const Labels = memo(function Labels({ fan, lit, homeIdx }: { fan: FanLayout; lit: ReadonlySet<number> | null; homeIdx: number }) {
  const buckets = new Map<number, FanNode[]>();
  for (const n of fan.nodes) {
    if (!n.label) continue;
    const fz = Math.max(1, Math.round(n.label.size));
    if (!buckets.has(fz)) buckets.set(fz, []);
    buckets.get(fz)!.push(n);
  }
  return (
    <g className="fan-labels" aria-hidden="true">
      {[...buckets].map(([fz, list]) => (
        <g key={fz} data-fz={fz}>
          {list.map((n) => {
            const l = n.label!;
            const i = fan.index.get(n.id)!;
            const dim = lit && !lit.has(i);
            const cls = [dim ? 'is-dim' : '', i === homeIdx ? 'is-home' : ''].filter(Boolean).join(' ');
            return (
              <g key={n.id} transform={`translate(${l.x} ${l.y}) rotate(${l.rotate})`} className={cls || undefined}>
                <text className="fan-name" y={l.nameY} fontSize={l.size}>
                  {l.text}
                  {l.spouse && l.spouseInline && (
                    <tspan className="fan-spouse" fontSize={l.spouseSize}>
                      {` ${l.spouse}`}
                    </tspan>
                  )}
                </text>
                {l.spouse && !l.spouseInline && (
                  <text className="fan-spouse" y={l.spouseY} fontSize={l.spouseSize}>
                    {l.spouse}
                  </text>
                )}
                {l.sub && (
                  <text className="fan-sub" y={l.subY} fontSize={l.subSize}>
                    {l.sub}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Hover card
// ---------------------------------------------------------------------------

interface CardProps {
  tree: Tree;
  node: FanNode;
  root: Person;
  kin: Map<string, string>;
  naming: Naming;
  at: { x: number; y: number };
  /** Their parent in the fan, the one descended from the root */
  parentId: string | null;
}

function FanCard({ tree, node, root, kin, naming, at, parentId }: CardProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const margin = 10;
    let left = at.x + 18;
    if (left + w > window.innerWidth - margin) left = at.x - w - 18;
    const top = Math.min(Math.max(margin, at.y - h / 2), window.innerHeight - h - margin);
    el.style.left = `${Math.round(Math.max(margin, left))}px`;
    el.style.top = `${Math.round(top)}px`;
    el.classList.add('is-placed');
  }, [at]);

  const p = node.person;
  const toMe = kin.get(p.id);
  const toRoot = node.depth > 0 ? relationName(tree, root.id, p.id, naming) : null;
  const partners = partnersOf(tree, p.id).filter((x) => x.union.status !== 'divorced' && !isNameless(x.person));
  const kidIds = indexOf(tree).children.get(p.id) ?? [];
  const kids = kidIds.length;
  const dead = p.deceased || Boolean(p.deathDate);
  // With more than one husband or wife, whose children are whose.
  const kidsWith = (id: string) => (partners.length > 1 ? kidIds.filter((k) => tree.people[k]?.parentIds.includes(id)).length : 0);
  // The parent who married into the family: the mother of a son's children, the father of a daughter's.
  const inLaw = node.depth > 0 ? p.parentIds.map((id) => tree.people[id]).find((x) => x && x.id !== parentId) : undefined;

  return createPortal(
    <div ref={ref} className="tl-card fan-card" role="tooltip" data-tone={node.branch >= 0 ? node.branch % SIDE_TONES : undefined}>
      <div className="tl-card-head">
        <Avatar person={p} size={40} />
        <div>
          {toMe && <span className="tl-card-eyebrow">{toMe}</span>}
          <strong>{standInName(tree, p, naming) || latePrefix(p, naming) + fullName(tree, p)}</strong>
        </div>
      </div>
      <dl className="tl-card-facts">
        {toRoot && (
          <div>
            <dt>{naming === 'en' ? `To ${treeName(tree, root, naming)}` : treeName(tree, root, naming)}</dt>
            <dd>
              <span className="fan-card-rel">{toRoot.label}</span>
              {toRoot.meaning && <span className="tl-card-muted"> · {toRoot.meaning}</span>}
            </dd>
          </div>
        )}
        {(p.birthDate || p.birthPlace) && (
          <div>
            <dt>Born</dt>
            <dd>
              {formatDate(p.birthDate) || <em>Date not recorded</em>}
              {p.birthPlace && <span className="tl-card-muted"> · {p.birthPlace}</span>}
            </dd>
          </div>
        )}
        {dead && p.deathDate && (
          <div>
            <dt>Died</dt>
            <dd>{formatDate(p.deathDate)}</dd>
          </div>
        )}
        {inLaw && !isNameless(inLaw) && (
          <div>
            <dt>{inLaw.gender === 'female' ? 'Mother' : inLaw.gender === 'male' ? 'Father' : 'Parent'}</dt>
            <dd>{treeName(tree, inLaw, naming)}</dd>
          </div>
        )}
        {partners.length > 0 && (
          <div>
            <dt>
              {partners.length > 1
                ? p.gender === 'female' ? 'Husbands' : p.gender === 'male' ? 'Wives' : 'Partners'
                : p.gender === 'female' ? 'Husband' : p.gender === 'male' ? 'Wife' : 'Partner'}
            </dt>
            <dd>
              {partners.map((x, i) => {
                const n = kidsWith(x.person.id);
                return (
                  <span key={x.person.id} className="fan-card-spouse">
                    {i > 0 && ', '}
                    {latePrefix(x.person, naming) + shortName(x.person)}
                    {n > 0 && <span className="tl-card-muted"> ({n} {n === 1 ? 'child' : 'children'})</span>}
                  </span>
                );
              })}
            </dd>
          </div>
        )}
        {kids > 0 && (
          <div>
            <dt>Family</dt>
            <dd>
              {kids} {kids === 1 ? 'child' : 'children'}
              {node.descendants > kids && <span className="tl-card-muted"> · {descendantsText(node.descendants, naming)}</span>}
            </dd>
          </div>
        )}
      </dl>
      {node.hidden > 0 && (
        <p className="tl-card-foot">
          {node.hidden === 1 ? '1 child is' : `${node.hidden} children are`} left out of the sons' line
        </p>
      )}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function FanView() {
  const tree = useStore((s) => s.tree);
  const naming = useStore((s) => s.naming);
  const prefs = useStore((s) => s.fan);
  const selectedId = useStore((s) => s.selectedId);
  const compareId = useStore((s) => s.compareId);
  const view = useStore((s) => s.view);
  const panelOpen = useStore((s) => Boolean(s.selectedId && s.tree.people[s.selectedId]));
  const { select, compare, setFan, toast, openDialog } = useStore.getState();

  const rootId = prefs.rootId && tree.people[prefs.rootId] ? prefs.rootId : defaultRoot(tree);
  const root = rootId ? tree.people[rootId] : undefined;
  const kin = relationLabels(tree, naming);

  const fan = useMemo(
    () => fanLayout(tree, rootId ?? '', { sonsOnly: prefs.sonsOnly, spouses: prefs.spouses }, (id) => kin.get(id) ?? '', naming),
    [tree, rootId, prefs.sonsOnly, prefs.spouses, kin, naming],
  );
  const live = useRef(fan);
  live.current = fan;

  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const tipTimer = useRef(0);

  const selIdx = selectedId ? (fan.index.get(selectedId) ?? -1) : -1;
  const cmpIdx = compareId ? (fan.index.get(compareId) ?? -1) : -1;
  const homeIdx = tree.homeId ? (fan.index.get(tree.homeId) ?? -1) : -1;

  // The selected person's line back to the root.
  const line = useMemo(() => {
    const s = new Set<number>();
    for (let j = selIdx; j > 0; j = fan.nodes[j].parent) s.add(j);
    return s;
  }, [selIdx, fan]);

  // Resting on someone lights their line down to the root and their whole family above them.
  const lit = useMemo(() => {
    if (hover === null || !fan.nodes[hover]) return null;
    const s = new Set<number>();
    for (let j = hover; j >= 0; j = fan.nodes[j].parent) s.add(j);
    const stack = [hover];
    while (stack.length) {
      const j = stack.pop()!;
      s.add(j);
      stack.push(...fan.nodes[j].kids);
    }
    return s;
  }, [hover, fan]);

  // --- Pan & zoom -----------------------------------------------------------
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  /** Showing the whole family as last fitted, so a change of size should fit it again. */
  const fitted = useRef(true);

  /** Shows only the labels big enough to read at this zoom. */
  const syncLabels = useCallback((k: number) => {
    const world = worldRef.current;
    if (!world) return;
    world.querySelectorAll<SVGGElement>('[data-fz]').forEach((g) => {
      g.style.display = Number(g.dataset.fz) * k >= READABLE_PX ? '' : 'none';
    });
  }, []);

  // A layout effect, so it is ready before the first fit below.
  useLayoutEffect(() => {
    const stage = stageRef.current!;
    const world = worldRef.current!;
    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .filter((event: Event) => {
        const e = event as MouseEvent;
        if (e.type === 'wheel') return true;
        if (e.button) return false;
        return !(e.target as HTMLElement).closest('.fan-legend, .fan-root, .fan-parents, .fan-add-child');
      })
      .on('zoom', (event: { transform: ZoomTransform; sourceEvent: Event | null }) => {
        const t = event.transform;
        // Panned or zoomed by hand: the view is no longer "the whole family".
        if (event.sourceEvent) fitted.current = false;
        world.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
        let grid = 28 * t.k;
        while (grid < 16) grid *= 2;
        stage.style.backgroundSize = `${grid}px ${grid}px`;
        stage.style.backgroundPosition = `${t.x}px ${t.y}px`;
        syncLabels(t.k);
        window.clearTimeout(tipTimer.current);
        setTip(null);
      });
    zoomRef.current = behavior;
    d3select(stage).call(behavior).on('dblclick.zoom', null);
    return () => {
      d3select(stage).on('.zoom', null);
    };
  }, [syncLabels]);

  // Labels are redrawn with the layout; show the right ones for the current zoom.
  useLayoutEffect(() => {
    if (stageRef.current) syncLabels(zoomTransform(stageRef.current).k);
  }, [fan, hover, syncLabels]);

  const moveTo = useCallback((t: ZoomTransform, animate: boolean) => {
    const stage = stageRef.current;
    if (!stage || !zoomRef.current) return;
    if (animate) d3select(stage).transition().duration(520).call(zoomRef.current!.transform, t);
    else d3select(stage).interrupt().call(zoomRef.current!.transform, t);
  }, []);

  const fitBox = useCallback(
    (box: Box, animate: boolean, maxK = 1.4) => {
      const stage = stageRef.current;
      if (!stage) return;
      // On a wide screen the list of branches keeps its own column on the left.
      const legend = stage.querySelector<HTMLElement>('.fan-legend');
      const inset = legend && stage.clientWidth > 1000 ? legend.offsetWidth + 12 : 0;
      const w = stage.clientWidth - inset;
      const h = stage.clientHeight;
      const margin = 28;
      const k = Math.max(MIN_ZOOM, Math.min(maxK, (w - margin * 2) / box.width, (h - margin * 2) / box.height));
      const x = inset + (w - box.width * k) / 2 - box.minX * k;
      const y = (h - box.height * k) / 2 - box.minY * k;
      moveTo(zoomIdentity.translate(x, y).scale(k), animate);
    },
    [moveTo],
  );

  const fit = useCallback(
    (animate = true) => {
      fitBox(live.current.bounds, animate, 1);
      fitted.current = true;
    },
    [fitBox],
  );

  const zoomBy = useCallback((factor: number) => {
    d3select(stageRef.current!).transition().duration(220).call(zoomRef.current!.scaleBy, factor);
  }, []);

  // A new family (or the first look) is fitted to the screen.
  const firstFit = useRef(true);
  useLayoutEffect(() => {
    fit(!firstFit.current);
    firstFit.current = false;
  }, [rootId, prefs.sonsOnly, fit]);

  // The details panel opening or closing changes the room there is: refit if the whole
  // family was showing, otherwise keep whatever was in the middle in the middle.
  useEffect(() => {
    const stage = stageRef.current!;
    let last = { w: stage.clientWidth, h: stage.clientHeight };
    const ro = new ResizeObserver(() => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (w === last.w && h === last.h) return;
      const t = zoomTransform(stage);
      const before = last;
      last = { w, h };
      if (fitted.current) return fit(true);
      const cx = (before.w / 2 - t.x) / t.k;
      const cy = (before.h / 2 - t.y) / t.k;
      moveTo(zoomIdentity.translate(w / 2 - cx * t.k, h / 2 - cy * t.k).scale(t.k), false);
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [fit, moveTo]);

  // "Fit", "go to person" and "keep person in view" requests from elsewhere in the app.
  const lastNonce = useRef(view.nonce);
  useEffect(() => {
    if (view.nonce === lastNonce.current) return;
    lastNonce.current = view.nonce;
    const stage = stageRef.current!;
    if (view.kind === 'fit') return fit();
    const i = view.id ? live.current.index.get(view.id) : undefined;
    if (i === undefined) return;
    const [wx, wy] = sliceCentre(live.current.nodes[i]);
    const t = zoomTransform(stage);
    const sx = t.applyX(wx);
    const sy = t.applyY(wy);
    const pad = 60;
    if (view.kind === 'reveal' && sx > pad && sy > pad && sx < stage.clientWidth - pad && sy < stage.clientHeight - pad) return;
    const k = view.kind === 'focus' ? Math.max(t.k, 0.9) : t.k;
    fitted.current = false;
    moveTo(zoomIdentity.translate(stage.clientWidth / 2 - wx * k, stage.clientHeight / 2 - wy * k).scale(k), true);
  }, [view, fit, moveTo]);

  // --- Pointer --------------------------------------------------------------
  const indexAt = (target: EventTarget | null) => {
    const el = (target as Element | null)?.closest?.('[data-i]') as SVGElement | null;
    return el ? Number(el.getAttribute('data-i')) : null;
  };

  const onPointerOver = (e: React.PointerEvent) => {
    const i = indexAt(e.target);
    if (i === null) return;
    setHover(i);
    window.clearTimeout(tipTimer.current);
    const at = { x: e.clientX, y: e.clientY };
    tipTimer.current = window.setTimeout(() => setTip({ i, ...at }), TIP_DELAY);
  };
  const onPointerOut = (e: React.PointerEvent) => {
    const from = indexAt(e.target);
    const to = indexAt(e.relatedTarget);
    if (from !== null && to === null) {
      setHover(null);
      window.clearTimeout(tipTimer.current);
      setTip(null);
    }
  };

  const reroot = (id: string) => {
    const n = live.current.nodes[live.current.index.get(id) ?? -1];
    const person = tree.people[id];
    if (!person) return;
    const hasKids = Boolean(indexOf(tree).children.get(id)?.length);
    if (!hasKids || (n && n.depth === 0)) {
      if (!hasKids) toast(`${shortName(person)} has no children in the tree yet`);
      return;
    }
    setHover(null);
    setTip(null);
    setFan({ rootId: id });
  };

  const onClick = (e: React.MouseEvent) => {
    const i = indexAt(e.target);
    if (i === null) {
      if (!(e.target as Element).closest('.fan-root, .fan-parents, .fan-legend, .fan-add-child')) select(null);
      return;
    }
    const id = fan.nodes[i].id;
    if (e.shiftKey) compare(id);
    else select(id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const i = indexAt(e.target);
    if (i !== null) reroot(fan.nodes[i].id);
  };

  // --- Keyboard -------------------------------------------------------------
  const trail = useRef(new Map<number, number>());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const { dialog, selectedId: current, tree: t, select: go } = useStore.getState();
      const el = e.target as HTMLElement;
      if (dialog || el.closest('input, textarea, select, [role="menu"], [role="dialog"]')) return;
      const f = live.current;
      const key = e.key.toLowerCase();
      if (key === 'f') return fit();
      if (key === '+' || key === '=') return zoomBy(1.35);
      if (key === '-') return zoomBy(1 / 1.35);
      if (key === 'h') return void (t.homeId && go(t.homeId, true));
      if (key === 'c' && current) return reroot(current);

      const dirs: Record<string, 'out' | 'in' | 'left' | 'right'> = {
        ArrowUp: 'out',
        ArrowDown: 'in',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };
      const dir = dirs[e.key];
      if (!dir) return;
      e.preventDefault();
      const i = current ? f.index.get(current) : undefined;
      if (i === undefined) return go(f.nodes[0]?.id ?? null);
      const n = f.nodes[i];
      let next: number | undefined;
      if (dir === 'in') {
        if (n.parent >= 0) {
          next = n.parent;
          trail.current.set(n.parent, i);
        }
      } else if (dir === 'out') {
        const back = trail.current.get(i);
        if (back !== undefined && n.kids.includes(back)) next = back;
        else if (n.kids.length) next = n.kids[Math.floor((n.kids.length - 1) / 2)];
      } else {
        // Round the ring: the next person of the same generation, left or right.
        const ring = f.nodes.map((_, j) => j).filter((j) => f.nodes[j].depth === n.depth);
        const at = ring.indexOf(i);
        next = ring[at + (dir === 'left' ? -1 : 1)];
      }
      if (next !== undefined) go(f.nodes[next].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // reroot only reads the store and the latest layout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, zoomBy]);

  // --- Export ---------------------------------------------------------------
  const picture = useRef<() => FanPicture | null>(() => null);
  picture.current = () => {
    const svg = worldRef.current?.querySelector<SVGSVGElement>('.fan-svg');
    if (!svg || !root) return null;
    const f = live.current;
    const word = naming === 'gu' ? 'વંશવૃક્ષ' : naming === 'gu-latn' ? 'Vansh-vruksh' : 'Family tree';
    return {
      svg,
      root,
      rootName: treeName(tree, root, naming),
      rootSpouse: f.nodes[0]?.spouses.length ? `& ${f.nodes[0].spouses.map((s) => treeName(tree, s, naming)).join(', ')}` : '',
      rootSpouses: f.nodes[0]?.spouses ?? [],
      rootRelation: kin.get(root.id) ?? '',
      rootR: ROOT_R,
      parents: root.parentIds
        .map((id) => tree.people[id])
        .filter((p): p is Person => Boolean(p))
        .map((p) => ({
          person: p,
          name: treeName(tree, p, naming),
          relation: relationName(tree, root.id, p.id, naming)?.label ?? '',
        })),
      parentsY: f.groundY + 34,
      title: standInName(tree, root, naming) || latePrefix(root, naming) + displayName(root),
      subtitle: `${word} · ${statsText(f.rings.length + 1, f.nodes.length - 1, f.living, naming)}`,
      fileName: `${displayName(root)} family tree`,
    };
  };
  useEffect(() => {
    canvasHandle.exportFanPng = async () => {
      // Every name that would be readable at full size goes into the picture.
      setHover(null);
      syncLabels(1);
      try {
        const pic = picture.current();
        if (pic) await downloadFanPng(pic);
      } finally {
        syncLabels(zoomTransform(stageRef.current!).k);
      }
    };
    return () => {
      canvasHandle.exportFanPng = null;
    };
  }, [syncLabels]);

  if (!root) return null;

  const branches = fan.nodes[0]?.kids ?? [];
  const hasDaughterLine = fan.nodes.some((n) => n.viaDaughter);
  const gens = fan.rings.length + 1;
  const parents = root.parentIds.map((id) => tree.people[id]).filter((p): p is Person => Boolean(p));
  const tipNode = tip ? fan.nodes[tip.i] : undefined;
  const rootRel = kin.get(root.id);
  const rootSpouses = fan.nodes[0]?.spouses ?? [];
  const rootSpouseText = rootSpouses.length ? `& ${rootSpouses.map((s) => treeName(tree, s, naming)).join(', ')}` : '';

  return (
    <section className={`fan${panelOpen ? ' is-panel-open' : ''}`} aria-label={`Descendants of ${displayName(root)}`}>
      <div className="fan-toolbar">
        <RootPicker tree={tree} root={root} kin={kin} naming={naming} />
        <span className="fan-stats">{statsText(gens, fan.nodes.length - 1, fan.living, naming)}</span>
        <span className="fan-spacer" />
        <div className="segmented fan-lineage" role="radiogroup" aria-label="Which descendants">
          <button
            type="button"
            role="radio"
            aria-checked={!prefs.sonsOnly}
            data-tip="Sons' and daughters' families"
            onClick={() => setFan({ sonsOnly: false })}
          >
            Everyone
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={prefs.sonsOnly}
            data-tip={naming === 'en' ? 'Only the line carried on by sons' : naming === 'gu' ? 'દીકરાઓનો વંશ - વંશાવળી' : 'Dikra no vansh - vanshavali'}
            onClick={() => setFan({ sonsOnly: true })}
          >
            Sons' line
          </button>
        </div>
        <button
          type="button"
          className="fan-toggle"
          aria-pressed={prefs.spouses}
          data-tip={
            naming === 'gu'
              ? 'પતિ-પત્નીનાં નામ'
              : naming === 'gu-latn'
                ? 'Pati-patni na naam'
                : prefs.spouses
                  ? 'Hide husbands and wives'
                  : 'Show husbands and wives'
          }
          onClick={() => setFan({ spouses: !prefs.spouses })}
        >
          <HeartHandshake size={15} />
          Spouses
        </button>
        <div className="control-group fan-zoom">
          <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.35)} aria-label="Zoom out" data-tip="Zoom out (−)">
            <Minus size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => zoomBy(1.35)} aria-label="Zoom in" data-tip="Zoom in (+)">
            <Plus size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => fit()} aria-label="Fit the whole family" data-tip="Fit (F)">
            <Maximize size={15} />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={`fan-stage${lit ? ' is-dimming' : ''}`}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        <div ref={worldRef} className="fan-world">
          <svg
            className="fan-svg"
            style={{ left: fan.bounds.minX, top: fan.bounds.minY, width: fan.bounds.width, height: fan.bounds.height }}
            viewBox={`${fan.bounds.minX} ${fan.bounds.minY} ${fan.bounds.width} ${fan.bounds.height}`}
            role="img"
            aria-label={`${displayName(root)} and ${fan.nodes.length - 1} descendants`}
          >
            <defs>
              {Array.from({ length: SIDE_TONES }, (_, t) => (
                <pattern key={t} id={`fan-hatch-${t}`} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="7" className="fan-hatch-line" data-tone={t} />
                </pattern>
              ))}
            </defs>
            <Trunk groundY={fan.groundY} />
            <Twigs fan={fan} lit={lit} line={line} selIdx={selIdx} cmpIdx={cmpIdx} homeIdx={homeIdx} />
            <Slices fan={fan} lit={lit} line={line} selIdx={selIdx} cmpIdx={cmpIdx} homeIdx={homeIdx} />
            <Labels fan={fan} lit={lit} homeIdx={homeIdx} />
            <g className="fan-rings" aria-hidden="true">
              {fan.rings.map((ring) =>
                ringLabelSpots(ring).slice(1).map((s, k) => (
                  <text key={`${ring.depth}-${k}`} x={s.x} y={s.y} textAnchor={s.anchor} className="fan-ring-label">
                    {generationName(ring.depth, naming, hasDaughterLine && !prefs.sonsOnly)}
                    <tspan className="fan-ring-count"> · {ring.count}</tspan>
                  </text>
                )),
              )}
            </g>
          </svg>

          <button
            type="button"
            className={`fan-root${selectedId === root.id ? ' is-selected' : ''}`}
            style={{ width: ROOT_R * 2, height: ROOT_R * 2 }}
            onClick={() => select(root.id)}
            onPointerEnter={() => setHover(0)}
            onPointerLeave={() => setHover(null)}
            aria-label={`${displayName(root)} - show details`}
          >
            <span className="fan-root-avatars">
              <Avatar person={root} size={52} />
              {rootSpouses.slice(0, 2).map((s) => (
                <Avatar key={s.id} person={s} size={40} />
              ))}
            </span>
            <span className="fan-root-name">{treeName(tree, root, naming)}</span>
            {rootSpouses.length > 0 && <span className="fan-root-spouse">{rootSpouseText}</span>}
            {rootRel && <span className="fan-root-rel">{rootRel}</span>}
          </button>

          {fan.nodes.length === 1 && (
            <button
              type="button"
              className="btn fan-add-child"
              style={{ top: ROOT_R + 18 }}
              onClick={() => openDialog({ type: 'add', relation: 'child', anchorId: root.id })}
            >
              <Plus size={15} />
              {`Add ${shortName(root)}'s children`}
            </button>
          )}

          {parents.length > 0 && (
            <div className="fan-parents" style={{ top: fan.groundY + 34 }}>
              {parents.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="fan-parent"
                  onClick={() => reroot(p.id)}
                  data-tip={`Show ${treeName(tree, p, naming)}'s family`}
                >
                  <Avatar person={p} size={26} />
                  <span>
                    <span className="fan-parent-rel">
                      {relationName(tree, root.id, p.id, naming)?.label ?? (p.gender === 'female' ? 'Mother' : 'Father')}
                    </span>
                    {treeName(tree, p, naming)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {branches.length > 0 && (
          <div className="fan-legend" onPointerLeave={() => setHover(null)}>
            <ul>
              {branches.map((i) => {
                const n = fan.nodes[i];
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      data-tone={n.branch % SIDE_TONES}
                      className={hover !== null && lit?.has(i) ? 'is-lit' : undefined}
                      onPointerEnter={() => setHover(i)}
                      onClick={() => {
                        fitBox(branchBox(fan, i), true, 1.6);
                        fitted.current = false;
                        select(n.id);
                      }}
                    >
                      <span className={`fan-swatch${n.person.gender === 'female' ? ' is-daughter' : ''}`} />
                      <span className="fan-legend-name">{treeName(tree, n.person, naming)}</span>
                      {kin.get(n.id) && <span className="fan-legend-rel">{kin.get(n.id)}</span>}
                      <span className="fan-legend-count">{n.descendants + 1}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {hasDaughterLine && !prefs.sonsOnly && (
              <p className="fan-legend-key">
                <span className="fan-swatch is-hatched" />
                {naming === 'gu' ? 'દીકરીનો પરિવાર' : naming === 'gu-latn' ? 'Dikri no parivar' : "A daughter's family"}
              </p>
            )}
          </div>
        )}
      </div>

      {tipNode && (
        <FanCard
          tree={tree}
          node={tipNode}
          root={root}
          kin={kin}
          naming={naming}
          at={{ x: tip!.x, y: tip!.y }}
          parentId={fan.nodes[tipNode.parent]?.id ?? null}
        />
      )}
    </section>
  );
}
