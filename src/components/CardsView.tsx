import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { Cake, ChevronDown, ChevronLeft, ChevronRight, MapPin, Network, RotateCw, Sparkles, X } from 'lucide-react';
import type { Person, Tree } from '../types';
import { useStore } from '../store';
import {
  DECKS,
  RARITY_LABEL,
  SORTS,
  cardStats,
  deckOf,
  generationTitle,
  handOf,
  hasCard,
  loadCollection,
  meaningFor,
  saveCollection,
  sortDeck,
  type CardSort,
  type Collection,
  type DeckKind,
  type Rarity,
} from '../lib/cards';
import { nextBirthday } from '../lib/almanac';
import { yearOf } from '../lib/dates';
import { relationLabels } from '../lib/naming';
import { childrenOf, fullName, indexOf, parentsOf, partnersOf, shortName, shown, siblingsOf } from '../lib/tree';
import { Avatar } from './Avatar';
import { CountUp } from './CountUp';
import { FamilyCard } from './FamilyCard';
import { WhoQuiz } from './WhoQuiz';
import { useSlidingThumb } from './SlidingThumb';
import { switchView } from '../lib/viewSwap';

const DECK_KEY = 'kindred.cards.deck';

type Tab = 'collection' | 'quiz';

function loadDeck(): DeckKind {
  try {
    const v = localStorage.getItem(DECK_KEY);
    return v === 'close' || v === 'all' ? v : 'family';
  } catch {
    return 'family';
  }
}

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Runs `update` as a view transition when the browser has them and motion is welcome. */
function transition(update: () => void): ViewTransition | null {
  if (!document.startViewTransition || still() || document.visibilityState !== 'visible') {
    update();
    return null;
  }
  const vt = document.startViewTransition(() => flushSync(update));
  vt.ready.catch(() => {});
  return vt;
}

// ---------------------------------------------------------------------------
// The back of a card in the spotlight: their life, their people, their next birthday
// ---------------------------------------------------------------------------

function LifeBar({ person, kids }: { person: Person; kids: Person[] }) {
  const born = yearOf(person.birthDate);
  if (!born) return null;
  const gone = person.deceased || Boolean(person.deathDate);
  const end = yearOf(person.deathDate) ?? (gone ? null : new Date().getFullYear());
  if (!end || end <= born) return null;
  const span = end - born;
  const at = (y: number) => `${(((y - born) / span) * 100).toFixed(1)}%`;
  const marks = kids
    .map((k) => ({ k, y: yearOf(k.birthDate) }))
    .filter((m): m is { k: Person; y: number } => m.y !== null && m.y >= born && m.y <= end);
  return (
    <div className="spot-life">
      <div className="spot-life-bar">
        <span className="spot-life-fill" />
        {marks.map(({ k, y }, i) => (
          <span
            key={k.id}
            className={`spot-life-mark g-${k.gender}`}
            style={{ left: at(y), animationDelay: `${300 + i * 90}ms` }}
            data-tip={`${shortName(k)} born ${y} · ${y - born} then`}
          />
        ))}
      </div>
      <div className="spot-life-years">
        <span>{born}</span>
        <span>{gone ? end : 'today'}</span>
      </div>
    </div>
  );
}

function People({ title, people, onGo }: { title: string; people: Person[]; onGo: (id: string) => void }) {
  if (!people.length) return null;
  const shownPeople = people.slice(0, people.length > 4 ? 3 : 4);
  return (
    <div className="spot-people">
      <span className="spot-people-title">{title}</span>
      <span className="spot-people-list">
        {shownPeople.map((p) => (
          <button
            key={p.id}
            type="button"
            className="spot-chip"
            onClick={(e) => {
              e.stopPropagation();
              onGo(p.id);
            }}
            data-tip={fullName(useStore.getState().tree, p)}
          >
            <Avatar person={p} size={20} />
            {shortName(p)}
          </button>
        ))}
        {people.length > shownPeople.length && <span className="spot-more">+{people.length - shownPeople.length}</span>}
      </span>
    </div>
  );
}

/** How many descend from someone in each generation below them: children, grandchildren… */
function generationsBelow(tree: Tree, id: string): number[] {
  const { children } = indexOf(tree);
  const out: number[] = [];
  const seen = new Set<string>([id]);
  let row = [id];
  while (row.length) {
    const next: string[] = [];
    for (const cur of row)
      for (const k of children.get(cur) ?? []) {
        if (seen.has(k) || !tree.people[k]) continue;
        seen.add(k);
        next.push(k);
      }
    if (next.length) out.push(next.length);
    row = next;
  }
  return out;
}

const BELOW = ['Children', 'Grandchildren', 'Great-grandchildren'];

/** A column of dots for each generation below someone, as tall as it is big. */
function Below({ counts }: { counts: number[] }) {
  if (!counts.length) return null;
  const most = Math.max(...counts);
  return (
    <div className="spot-people">
      <span className="spot-people-title">Their family below them</span>
      <div className="spot-below">
        {counts.map((n, i) => (
          <div key={i} className="spot-below-gen" data-tip={`${n} ${BELOW[i]?.toLowerCase() ?? `in generation ${i + 1}`}`}>
            <span className="spot-below-bar" style={{ '--h': n / most, '--i': i } as CSSProperties} />
            <span className="spot-below-n">{n}</span>
            <span className="spot-below-label">{BELOW[i] ?? `${i - 1}× great`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardDetails({ tree, person, onGo }: { tree: Tree; person: Person; onGo: (id: string) => void }) {
  const naming = useStore((s) => s.naming);
  const kin = relationLabels(tree, naming).get(person.id) ?? '';
  const siblings = siblingsOf(tree, person.id).filter(hasCard);
  const below = generationsBelow(tree, person.id);
  const parents = parentsOf(tree, person.id).filter(hasCard);
  const partners = partnersOf(tree, person.id).map((x) => x.person).filter(hasCard);
  const kids = childrenOf(tree, person.id).filter(hasCard);
  const birthday = nextBirthday(tree, person);
  // Rows of chips the back has to fit; the generations strip only goes in when there's room.
  const rows = [parents, partners, kids, siblings].reduce((n, list) => n + (list.length ? (list.length > 2 ? 2 : 1) : 0), 0);
  return (
    <div className="spot-details">
      <div>
        {kin && <div className="spot-details-kin">{kin}</div>}
        <div className="spot-details-name">{fullName(tree, person)}</div>
      </div>
      <LifeBar person={person} kids={kids} />
      <People title="Parents" people={parents} onGo={onGo} />
      <People title={partners.length > 1 ? 'Partners' : 'Partner'} people={partners} onGo={onGo} />
      <People title="Children" people={kids} onGo={onGo} />
      <People title="Brothers and sisters" people={siblings} onGo={onGo} />
      {below.length > 1 && rows <= 4 && <Below counts={below} />}
      <div className="spot-facts">
        {birthday && (
          <span>
            <Cake size={13} />
            {birthday.daysAway === 0
              ? `Birthday today${birthday.turns ? ` · ${birthday.turns}` : ''}`
              : `Birthday in ${birthday.daysAway} day${birthday.daysAway === 1 ? '' : 's'}${birthday.turns ? ` · turns ${birthday.turns}` : ''}`}
          </span>
        )}
        {person.birthPlace && (
          <span>
            <MapPin size={13} />
            {shown(person.birthPlace)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The spotlight: one card big, tilting, turning over, walking to the people it names
// ---------------------------------------------------------------------------

function Spotlight({
  id,
  order,
  numberOf,
  known,
  onGo,
  onClose,
}: {
  id: string;
  order: string[];
  numberOf: Map<string, number>;
  known: ReadonlySet<string>;
  onGo: (id: string, dir?: 1 | -1) => void;
  onClose: () => void;
}) {
  const tree = useStore((s) => s.tree);
  const naming = useStore((s) => s.naming);
  const [flipped, setFlipped] = useState(false);
  const [dir, setDir] = useState<1 | -1 | 0>(0);
  const person = tree.people[id];
  const at = order.indexOf(id);
  const labels = relationLabels(tree, naming);
  const meaning = meaningFor(tree, naming);
  const stats = cardStats(tree);

  const go = useCallback(
    (next: string, d: 1 | -1 | 0) => {
      setDir(d);
      setFlipped(false);
      onGo(next);
    },
    [onGo],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().dialog) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' && at >= 0 && at < order.length - 1) go(order[at + 1], 1);
      else if (e.key === 'ArrowLeft' && at > 0) go(order[at - 1], -1);
      else if (e.key === ' ' || e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, order, go, onClose]);

  if (!person) return null;
  const s = stats.get(id)!;
  const showInTree = () => {
    switchView('tree');
    useStore.getState().select(id, true);
  };

  return (
    <div className="spot" role="dialog" aria-label={`${shortName(person)}'s card`}>
      <button type="button" className="spot-backdrop" aria-label="Close" onClick={onClose} />
      <button
        type="button"
        className="spot-nav is-prev"
        aria-label="Previous card"
        data-tip="Previous (←)"
        disabled={at <= 0}
        onClick={() => go(order[at - 1], -1)}
      >
        <ChevronLeft size={22} />
      </button>
      <div className={`spot-stage${dir === 1 ? ' from-right' : dir === -1 ? ' from-left' : ''}`} key={id}>
        <FamilyCard
          person={person}
          stats={s}
          kin={labels.get(id) ?? ''}
          meaning={meaning(id)}
          no={numberOf.get(id)}
          total={order.length}
          known={known.has(id)}
          home={id === tree.homeId}
          flipped={flipped}
          tilt
          className="spot-card"
          style={{ viewTransitionName: 'spot-card' } as CSSProperties}
          onClick={() => setFlipped((f) => !f)}
          label={`${shortName(person)}: turn the card over`}
          back={<CardDetails tree={tree} person={person} onGo={(next) => go(next, 0)} />}
        />
      </div>
      <button
        type="button"
        className="spot-nav is-next"
        aria-label="Next card"
        data-tip="Next (→)"
        disabled={at < 0 || at >= order.length - 1}
        onClick={() => go(order[at + 1], 1)}
      >
        <ChevronRight size={22} />
      </button>
      <div className="spot-bar">
        <button type="button" className="spot-btn" onClick={() => setFlipped((f) => !f)} data-tip="Turn over (Space)">
          <RotateCw size={15} />
          {flipped ? 'Front' : 'Back'}
        </button>
        <button type="button" className="spot-btn" onClick={showInTree}>
          <Network size={15} />
          Show in tree
        </button>
        <span className="spot-pos">
          {s.rarity !== 'common' && <span className={`spot-rarity is-${s.rarity}`}>{RARITY_LABEL[s.rarity]}</span>}
          {at >= 0 ? `${at + 1} of ${order.length}` : ''}
        </span>
        <button type="button" className="icon-btn spot-close" aria-label="Close" data-tip="Close (Esc)" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The hand: the deck's rarest cards fanned out at the top
// ---------------------------------------------------------------------------

const Hand = memo(function Hand({
  ids,
  onOpen,
  known,
}: {
  ids: string[];
  onOpen: (id: string, el: HTMLElement) => void;
  known: ReadonlySet<string>;
}) {
  const tree = useStore((s) => s.tree);
  const naming = useStore((s) => s.naming);
  const labels = relationLabels(tree, naming);
  const stats = cardStats(tree);
  const mid = (ids.length - 1) / 2;
  return (
    <div className="hand" aria-label="The rarest cards">
      {ids.map((id, i) => {
        const off = i - mid;
        const p = tree.people[id];
        return (
          <FamilyCard
            key={id}
            person={p}
            stats={stats.get(id)!}
            kin={labels.get(id) ?? ''}
            known={known.has(id)}
            home={id === tree.homeId}
            className="hand-card"
            style={
              {
                '--rot': `${off * 7}deg`,
                '--dy': `${Math.abs(off) ** 1.6 * 7}px`,
                '--off': off,
                '--i': i,
                zIndex: 10 - Math.round(Math.abs(off)),
              } as CSSProperties
            }
            onOpen={onOpen}
          />
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------------------
// The grid: only the rows near the screen are on the page
// ---------------------------------------------------------------------------

/** How far past the screen's edges rows are kept ready, in pixels. */
const OVERSCAN = 800;
/** The scroll position is followed in steps this big, so scrolling re-renders rarely. */
const STEP = 160;
/**
 * Cards this close to the screen are put on the page straight away. Every other card in
 * reach is filled in a few a frame, nearest first, so no single frame has to build a
 * whole row of cards (or a whole screenful when the deck opens). The zone is placed from
 * where the screen was at the last step, so this is more than STEP: it still covers the
 * screen however far the scroll has run on towards the next one.
 */
const NEAR = 200;
/** Cards filled in per frame while rows held ready are still empty. */
const PER_FRAME = 2;

interface Metrics {
  cols: number;
  cardH: number;
  gapY: number;
  headH: number;
}

type Row =
  | { kind: 'head'; gen: number | null; count: number; top: number; h: number }
  | { kind: 'cards'; cells: { id: string; i: number }[]; top: number; h: number };

/** The grid's columns and row heights, as its stylesheet lays them out at this width. */
function measure(grid: HTMLElement): Metrics {
  const cs = getComputedStyle(grid);
  const cols = Math.max(1, cs.gridTemplateColumns.split(' ').filter((t) => t && t !== 'none').length);
  const fs = parseFloat(cs.getPropertyValue('--card-fs')) || 9.4;
  const head = grid.querySelector<HTMLElement>('.cards-gen');
  let headH = 46;
  if (head) {
    const hs = getComputedStyle(head);
    headH = head.getBoundingClientRect().height + parseFloat(hs.marginTop) + parseFloat(hs.marginBottom);
  }
  return { cols, cardH: 25.2 * fs, gapY: parseFloat(cs.rowGap) || 0, headH };
}

const sameMetrics = (a: Metrics, b: Metrics) =>
  a.cols === b.cols && Math.abs(a.cardH - b.cardH) < 0.01 && a.gapY === b.gapY && Math.abs(a.headH - b.headH) < 0.01;

interface CardGridProps {
  order: string[];
  sort: CardSort;
  total: number;
  numberOf: Map<string, number>;
  known: ReadonlySet<string>;
  meaning: (id: string) => string;
  onOpen: (id: string, el: HTMLElement) => void;
  gridRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Every card in the deck, a heading wherever a generation starts. A deck can be the
 * whole tree (thousands of cards), so only the rows within reach of the screen are
 * rendered, with spacers above and below holding the rest of the grid's height; each
 * row's height is known from the stylesheet, so nothing has to be measured card by card.
 */
const CardGrid = memo(function CardGrid({ order, sort, total, numberOf, known, meaning, onOpen, gridRef }: CardGridProps) {
  const tree = useStore((s) => s.tree);
  const naming = useStore((s) => s.naming);
  const stats = cardStats(tree);
  const labels = relationLabels(tree, naming);
  const [m, setM] = useState<Metrics>({ cols: 5, cardH: 237, gapY: 24, headH: 46 });
  // The slice of the grid in reach: its top and bottom in steps of STEP, and where the
  // screen was when it last moved on a step. Null until the grid has been measured on the
  // page, which happens before anything is painted.
  const [view, setView] = useState<{ from: number; to: number; top: number; h: number; opening: boolean } | null>(null);
  // Cards filled in so far (beyond those near the screen, which always are), and a count
  // that moves on as more are, to render again.
  const ready = useRef(new Set<string>());
  const [, setFilled] = useState(0);
  // Each dealt card's place in the deal. It stays on the card after the deal is over:
  // taking a custom property off a card restyles everything printed on it.
  const dealt = useRef(new Map<string, CSSProperties>());
  // Cards are dealt in only as the deck opens; rows that scroll into reach later just appear.
  const [dealing, setDealing] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setDealing(false), 1600);
    return () => clearTimeout(t);
  }, []);

  const rows = useMemo(() => {
    const out: Row[] = [];
    let y = 0;
    let row: { id: string; i: number }[] | null = null;
    let lastGen: number | null | undefined;
    const counts = new Map<number | null, number>();
    if (sort === 'generation') for (const id of order) counts.set(stats.get(id)!.gen, (counts.get(stats.get(id)!.gen) ?? 0) + 1);
    const close = () => {
      if (!row) return;
      out.push({ kind: 'cards', cells: row, top: y, h: m.cardH });
      y += m.cardH + m.gapY;
      row = null;
    };
    order.forEach((id, i) => {
      const gen = stats.get(id)!.gen;
      if (sort === 'generation' && gen !== lastGen) {
        close();
        out.push({ kind: 'head', gen, count: counts.get(gen) ?? 0, top: y, h: m.headH });
        y += m.headH + m.gapY;
        lastGen = gen;
      }
      (row ??= []).push({ id, i });
      if (row.length === m.cols) close();
    });
    close();
    return { list: out, height: Math.max(0, y - m.gapY) };
  }, [order, sort, stats, m]);

  // Follows the scroll and the size of the grid. The scroller is found from the grid
  // itself: a parent's ref isn't set yet when a child's layout effects first run.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const scroller = grid?.closest<HTMLElement>('.cards-scroll');
    if (!grid || !scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scroller.scrollTop - grid.offsetTop;
      const from = Math.floor((top - OVERSCAN) / STEP);
      const to = Math.ceil((top + scroller.clientHeight + OVERSCAN) / STEP);
      const h = scroller.clientHeight;
      setView((v) => (v && v.from === from && v.to === to && v.h === h ? v : { from, to, top, h, opening: !v }));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const remeasure = () => {
      const next = measure(grid);
      setM((cur) => (sameMetrics(cur, next) ? cur : next));
      update();
    };
    remeasure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(remeasure);
    ro.observe(scroller);
    ro.observe(grid);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [gridRef]);

  // Rare and legendary cards only shimmer while they're on screen: the ones held ready
  // above and below sit still, so they cost the compositor nothing until they're seen.
  const io = useRef<IntersectionObserver | null>(null);
  const watched = useRef(new Set<HTMLElement>());
  useLayoutEffect(() => {
    const scroller = gridRef.current?.closest<HTMLElement>('.cards-scroll');
    if (!scroller) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) {
            if (el.dataset.on === undefined) el.dataset.on = '';
          } else if (el.dataset.on !== undefined) delete el.dataset.on;
        }
      },
      { root: scroller, rootMargin: '40px 0px' },
    );
    io.current = obs;
    const seen = watched.current;
    return () => {
      obs.disconnect();
      io.current = null;
      seen.clear();
    };
  }, [gridRef]);

  // A heading's height is only known once one is on the page.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || sort !== 'generation') return;
    const next = measure(grid);
    setM((cur) => (sameMetrics(cur, next) ? cur : next));
  }, [gridRef, sort]);

  const lo = view ? view.from * STEP : 0;
  const hi = view ? view.to * STEP : window.innerHeight + OVERSCAN;
  // The part of the grid near the screen, where cards are always drawn in full. As the
  // deck opens that is just what's on screen, to put as little as possible into the frame
  // it opens in; the rest follows a few cards a frame.
  const margin = view?.opening && dealing ? 0 : NEAR;
  const nearLo = view ? view.top - margin : 0;
  const nearHi = view ? view.top + view.h + margin : -1;
  const list = rows.list;
  let first = 0;
  while (first < list.length && list[first].top + list[first].h < lo) first++;
  let last = first;
  while (last + 1 < list.length && list[last + 1].top <= hi) last++;
  const shown = list.slice(first, last + 1);
  const near = (r: Row) => r.top + r.h >= nearLo && r.top <= nearHi;
  const drawn = (r: Row, id: string) => near(r) || ready.current.has(id);
  const dealStyle = (id: string, i: number) => {
    let s = dealt.current.get(id);
    if (!s && dealing) dealt.current.set(id, (s = { '--i': i } as CSSProperties));
    return s;
  };

  // After each change: the cards drawn near the screen stay drawn while they're in reach,
  // those that have left it are forgotten, and the rest are filled in a few a frame.
  useEffect(() => {
    const keep = ready.current;
    const inReach = new Set<string>();
    const waiting: { id: string; d: number }[] = [];
    const mid = (nearLo + nearHi) / 2;
    for (const r of shown) {
      if (r.kind !== 'cards') continue;
      for (const c of r.cells) {
        inReach.add(c.id);
        if (near(r)) keep.add(c.id);
        else if (!keep.has(c.id)) waiting.push({ id: c.id, d: Math.abs(r.top + r.h / 2 - mid) });
      }
    }
    for (const id of keep) if (!inReach.has(id)) keep.delete(id);
    for (const id of dealt.current.keys()) if (!inReach.has(id)) dealt.current.delete(id);
    if (!waiting.length || !view) return;
    waiting.sort((a, b) => a.d - b.d);
    const frame = requestAnimationFrame(() => {
      for (const w of waiting.slice(0, PER_FRAME)) keep.add(w.id);
      setFilled((n) => n + 1);
    });
    return () => cancelAnimationFrame(frame);
  });

  // Rare and legendary cards just put on the page are watched; those gone are let go.
  useLayoutEffect(() => {
    const obs = io.current;
    const grid = gridRef.current;
    if (!obs || !grid) return;
    const seen = watched.current;
    for (const el of seen)
      if (!el.isConnected) {
        obs.unobserve(el);
        seen.delete(el);
      }
    grid.querySelectorAll<HTMLElement>('.grid-card.is-rare, .grid-card.is-legend').forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      obs.observe(el);
    });
  });
  const end = shown.length ? shown[shown.length - 1].top + shown[shown.length - 1].h : 0;

  return (
    <div className={`cards-grid${dealing ? ' is-dealing' : ''}`} ref={gridRef} style={{ minHeight: rows.height }}>
      {first > 0 && shown.length > 0 && <div className="cards-pad" style={{ height: Math.max(0, shown[0].top - m.gapY) }} />}
      {/* One flat list, every card keyed by who it is. Rows as nested lists would be matched
          by position, so each time a row left the top every card below it was rebuilt. */}
      {shown.flatMap((r) =>
        r.kind === 'head' ? (
          <h3 key={`h${r.gen}`} className="cards-gen">
            {generationTitle(r.gen)}
            <span>{r.count}</span>
          </h3>
        ) : (
          r.cells.map((c) =>
            !drawn(r, c.id) ? (
              <div key={c.id} className="fc grid-slot" aria-hidden="true" />
            ) : (
            <FamilyCard
              key={c.id}
              person={tree.people[c.id]}
              stats={stats.get(c.id)!}
              kin={labels.get(c.id) ?? ''}
              meaning={meaning(c.id)}
              no={numberOf.get(c.id)}
              total={total}
              known={known.has(c.id)}
              home={c.id === tree.homeId}
              className="grid-card"
              style={dealStyle(c.id, c.i)}
              onOpen={onOpen}
            />
            ),
          )
        ),
      )}
      {last < list.length - 1 && <div className="cards-pad" style={{ height: Math.max(0, rows.height - end - m.gapY) }} />}
    </div>
  );
});

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

const RARITIES: Rarity[] = ['legend', 'rare', 'common'];
const GLYPH: Record<Rarity, string> = { legend: '★', rare: '◆', common: '●' };

export function CardsView() {
  const tree = useStore((s) => s.tree);
  const naming = useStore((s) => s.naming);
  const [deck, setDeckState] = useState<DeckKind>(loadDeck);
  const [tab, setTab] = useState<Tab>('collection');
  const [sort, setSortState] = useState<CardSort>('generation');
  const [collection, setCollection] = useState<Collection>(loadCollection);
  const [spot, setSpot] = useState<string | null>(null);

  const known = useMemo(() => new Set(collection.known), [collection]);
  const ids = useMemo(() => deckOf(tree, deck), [tree, deck]);
  const order = useMemo(() => sortDeck(tree, ids, sort), [tree, ids, sort]);
  const numberOf = useMemo(() => new Map(ids.map((id, i) => [id, i + 1])), [ids]);
  const hand = useMemo(() => handOf(tree, ids), [tree, ids]);
  const stats = cardStats(tree);
  const meaning = useMemo(() => meaningFor(tree, naming), [tree, naming]);

  const counts = useMemo(() => {
    const c: Record<Rarity, number> = { legend: 0, rare: 0, common: 0 };
    for (const id of ids) c[stats.get(id)!.rarity]++;
    return c;
  }, [ids, stats]);
  const knownHere = useMemo(() => ids.filter((id) => known.has(id)).length, [ids, known]);

  const setDeck = (d: DeckKind) => {
    try {
      localStorage.setItem(DECK_KEY, d);
    } catch {
      /* the choice just won't persist */
    }
    setDeckState(d);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  // --- Reordering: each card glides from where it was to where it lands ---------------
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const flipFrom = useRef<Map<string, DOMRect> | null>(null);
  const setSort = (s: CardSort) => {
    if (s === sort) return;
    const grid = gridRef.current;
    if (grid && !still()) {
      const rects = new Map<string, DOMRect>();
      grid.querySelectorAll<HTMLElement>('.grid-card').forEach((el) => rects.set(el.dataset.id!, el.getBoundingClientRect()));
      flipFrom.current = rects;
    }
    setSortState(s);
  };
  useLayoutEffect(() => {
    const from = flipFrom.current;
    const grid = gridRef.current;
    flipFrom.current = null;
    if (!from || !grid) return;
    const view = scrollRef.current!.getBoundingClientRect();
    const near = (r: DOMRect) => r.bottom > view.top - 200 && r.top < view.bottom + 200;
    let n = 0;
    grid.querySelectorAll<HTMLElement>('.grid-card').forEach((el) => {
      const to = el.getBoundingClientRect();
      const was = from.get(el.dataset.id!);
      if (!near(to) && (!was || !near(was))) return;
      const delay = Math.min(n++, 40) * 6;
      if (was) {
        const dx = was.left - to.left;
        const dy = was.top - to.top;
        if (!dx && !dy) return;
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) rotate(${(Math.random() - 0.5) * 10}deg)`, zIndex: 2 },
            { transform: 'none', zIndex: 2 },
          ],
          { duration: 560, delay, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' },
        );
      } else {
        el.animate([{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'none' }], {
          duration: 420,
          delay: 200 + delay,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          fill: 'backwards',
        });
      }
    });
  }, [sort]);

  // --- The spotlight ------------------------------------------------------------------
  const open = useCallback((id: string, el: HTMLElement | null) => {
    if (!el) {
      setSpot(id);
      return;
    }
    el.style.viewTransitionName = 'spot-card';
    const vt = transition(() => {
      el.style.viewTransitionName = '';
      setSpot(id);
    });
    if (!vt) el.style.viewTransitionName = '';
  }, []);

  const close = useCallback(() => {
    const id = spot;
    if (!id) return;
    const el =
      gridRef.current?.querySelector<HTMLElement>(`.grid-card[data-id="${CSS.escape(id)}"]`) ??
      document.querySelector<HTMLElement>(`.hand-card[data-id="${CSS.escape(id)}"]`);
    const r = el?.getBoundingClientRect();
    const view = scrollRef.current?.getBoundingClientRect();
    const onScreen = r && view && r.bottom > view.top && r.top < view.bottom;
    if (!el || !onScreen) {
      setSpot(null);
      return;
    }
    const vt = transition(() => {
      setSpot(null);
      el.style.viewTransitionName = 'spot-card';
    });
    if (vt) void vt.finished.finally(() => (el.style.viewTransitionName = ''));
    else el.style.viewTransitionName = '';
  }, [spot]);

  // Leaving the spotlight on someone outside the deck (a parent opened from a card's back)
  // still closes cleanly; the grid keeps showing them if they are in it.
  const goTo = useCallback((id: string) => setSpot(id), []);

  const markKnown = useCallback((ids: string[]) => {
    setCollection((c) => {
      const next = { ...c, known: [...new Set([...c.known, ...ids])] };
      saveCollection(next);
      return next;
    });
  }, []);
  const endRound = useCallback((bestStreak: number) => {
    setCollection((c) => {
      const next = { ...c, best: Math.max(c.best, bestStreak), played: c.played + 1 };
      saveCollection(next);
      return next;
    });
  }, []);

  const tabsRef = useRef<HTMLDivElement>(null);
  useSlidingThumb(tabsRef, tab);

  const deckLabel = DECKS.find((d) => d.kind === deck)!.label;
  return (
    <div className={`cards${spot ? ' has-spot' : ''}`}>
      <div className="view-bar cards-bar">
        <div className="segmented cards-tabs" role="tablist" aria-label="Cards" ref={tabsRef}>
          <span className="seg-thumb" aria-hidden="true" />
          <button type="button" role="tab" aria-selected={tab === 'collection'} onClick={() => setTab('collection')}>
            Collection
          </button>
          <button type="button" role="tab" aria-selected={tab === 'quiz'} onClick={() => setTab('quiz')}>
            <Sparkles size={14} />
            Who's who?
          </button>
        </div>
        <span className="view-bar-sep" aria-hidden="true" />
        <label className="fan-lineage" data-tip={DECKS.find((d) => d.kind === deck)!.tip}>
          <select aria-label="Which cards" value={deck} onChange={(e) => setDeck(e.target.value as DeckKind)}>
            {DECKS.map((d) => (
              <option key={d.kind} value={d.kind}>
                {d.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
        {tab === 'collection' && (
          <>
            <span className="view-bar-sep" aria-hidden="true" />
            <label className="fan-lineage">
              <select aria-label="Order" value={sort} onChange={(e) => setSort(e.target.value as CardSort)}>
                {SORTS.map((s) => (
                  <option key={s.sort} value={s.sort}>
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
          </>
        )}
      </div>

      {tab === 'collection' ? (
        <div className="cards-scroll" ref={scrollRef}>
          <section className="cards-hero" key={`hero-${deck}`}>
            <div className="cards-intro">
              <span className="cards-kicker">{tree.name}</span>
              <h2 className="cards-title">{deckLabel}</h2>
              <p className="cards-count">
                <CountUp value={ids.length} className="cards-count-n" /> cards
              </p>
              <ul className="cards-rarities">
                {RARITIES.map((r) => (
                  <li key={r} className={`is-${r}`}>
                    <span className="cards-glyph" aria-hidden="true">
                      {GLYPH[r]}
                    </span>
                    <CountUp value={counts[r]} ms={700} /> {RARITY_LABEL[r]}
                  </li>
                ))}
              </ul>
              <div className="cards-progress" data-tip="Named in Who's who?">
                <span className="cards-progress-track">
                  <span
                    className="cards-progress-fill"
                    style={{ width: `${ids.length ? (knownHere / ids.length) * 100 : 0}%` }}
                  />
                </span>
                <span className="cards-progress-text">
                  {knownHere} of {ids.length} known
                </span>
              </div>
              <button type="button" className="btn btn-primary cards-play" onClick={() => setTab('quiz')}>
                <Sparkles size={15} />
                Play Who's who?
              </button>
            </div>
            <Hand ids={hand} known={known} onOpen={open} />
          </section>

          <CardGrid
            key={`grid-${deck}`}
            order={order}
            sort={sort}
            total={ids.length}
            numberOf={numberOf}
            known={known}
            meaning={meaning}
            onOpen={open}
            gridRef={gridRef}
          />
        </div>
      ) : (
        <WhoQuiz pool={ids} known={known} best={collection.best} onKnown={markKnown} onRoundEnd={endRound} onCollection={() => setTab('collection')} />
      )}

      {spot && tree.people[spot] && (
        <Spotlight id={spot} order={order} numberOf={numberOf} known={known} onGo={goTo} onClose={close} />
      )}
    </div>
  );
}

