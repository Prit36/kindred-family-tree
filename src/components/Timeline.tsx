import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Baby, CalendarPlus, Flower2, House, Maximize, Minus, Plus, X } from 'lucide-react';
import type { Person } from '../types';
import { useStore } from '../store';
import { focusSet } from '../lib/branches';
import { ageOf, formatDate, yearOf } from '../lib/dates';
import { relationLabels } from '../lib/naming';
import {
  ageAt,
  axisTicks,
  countAlive,
  indexLifetimes,
  nowYear,
  overlapYears,
  timelineRows,
  together,
  togetherWhen,
  yearsText,
  type Span,
  type TimelineOrder,
} from '../lib/timeline';
import { childrenOf, displayName, parentsOf, partnersOf, shortName } from '../lib/tree';
import { Avatar } from './Avatar';

const ROW_H = 44;
const AXIS_H = 36;
const BAR_TOP = 10;
const BAR_H = 24;
/** The selected person's life events hang below their bar in lanes this tall. */
const LANE_H = 30;
const EVENTS_GAP = 10;
/** Space before the earliest and after the latest year, so bars never touch the edges. */
const PAD = 28;
/** Room at the bottom so the last rows can scroll clear of the floating banners. */
const BOTTOM_ROOM = 72;
const MIN_PPY = 1.5;
const MAX_PPY = 90;
const ZOOM_STEP = 1.5;
/** Fades at the ends of a bar whose date is a guess. */
const FADE = 44;
/** How long the pointer rests on a bar before its card opens. */
const TIP_DELAY = 400;
/** How far past the screen (above and below) rows are drawn ahead of scrolling. */
const BAND_MARGIN = 600;

const ORDER_KEY = 'kindred.timeline.order';

function loadOrder(): TimelineOrder {
  try {
    return localStorage.getItem(ORDER_KEY) === 'family' ? 'family' : 'birth';
  } catch {
    return 'birth';
  }
}

const countPeople = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** A rough width for a label, to decide whether it fits inside its bar. */
const textWidth = (s: string) => s.length * 6.4 + 4;

/** "1932 – 2010" and "77 yrs" for a bar. */
function barText(s: Span): { years: string; age: string } {
  const p = s.person;
  const b = yearOf(p.birthDate);
  const d = yearOf(p.deathDate);
  const years = `${b ?? '?'} – ${d ?? (s.living ? 'today' : '?')}`;
  const age = ageOf(p);
  return { years, age: age === null ? '' : `${age} yrs` };
}

const byGender = (p: Person, male: string, female: string, other: string) =>
  p.gender === 'male' ? male : p.gender === 'female' ? female : other;

/** A child's birth, shown as a dot on a parent's bar. */
interface Birth {
  child: Person;
  /** The parent's age at the time, when known */
  parentAge: number | null;
}

interface Pin {
  /** Position along the parent's bar, in pixels */
  x: number;
  births: Birth[];
}

/** Births closer together than this (in pixels) share one dot. */
const PIN_GAP = 12;

/** Something that happened in the selected person's life, shown as a labelled chip under their bar. */
interface LifeEvent {
  key: string;
  /** Who it happened to */
  person: Person;
  kind: 'born' | 'died';
  /** Who they were to the selected person: "son", "father", "wife" */
  role: string;
  /** "Chloe born" */
  label: string;
  date: string;
  year: number;
  /** The selected person's age at the time */
  age: number | null;
  /** Where it happened on the track, and where its chip sits */
  x: number;
  left: number;
  lane: number;
}

interface RowProps {
  span: Span;
  nameW: number;
  trackW: number;
  /** Where the row sits in the list, in pixels from the top of the first row */
  top: number;
  height: number;
  /** Bar position in track pixels */
  left: number;
  width: number;
  selected: boolean;
  compared: boolean;
  /** The row Tab lands on: the selected one, or the first. */
  tabbable: boolean;
  isHome: boolean;
  /** Someone else is selected: this bar is muted except where it overlaps them. */
  muted: boolean;
  overlap: { left: number; width: number } | null;
  relation: string;
  events: LifeEvent[];
  pins: Pin[];
  /** Dots for these children are part of the selected person's family lines. */
  linkedChildIds: ReadonlySet<string>;
  compact: boolean;
  onPick: (id: string, e: MouseEvent) => void;
  onEdit: (id: string) => void;
}

const TimelineRow = memo(function TimelineRow({
  span,
  nameW,
  trackW,
  top,
  height,
  left,
  width,
  selected,
  compared,
  tabbable,
  isHome,
  muted,
  overlap,
  relation,
  events,
  pins,
  linkedChildIds,
  compact,
  onPick,
  onEdit,
}: RowProps) {
  const p = span.person;
  const barW = Math.max(width, 6);
  const { years, age } = barText(span);
  const full = age ? `${years}  ·  ${age}` : years;

  // The label goes inside the bar when it fits (the age only if there's room for it too),
  // else beside the bar (after it, or before it; with the age if that fits too) - and when
  // there's no room anywhere, inside anyway, cut short.
  const inset = span.startKnown ? 10 : FADE - 8;
  const room = width - inset - (span.endKnown ? 10 : FADE - 8);
  const fitsYears = room >= textWidth(years);
  const fitsAge = Boolean(age) && room >= textWidth(full);
  const spaceAfter = trackW - (left + barW) - 14;
  const spaceBefore = left - 14;
  let side: 'inside' | 'after' | 'before' = 'inside';
  let sideAge = false;
  if (!fitsYears) {
    const fullW = textWidth(full);
    const yearsW = textWidth(years);
    if (age && spaceAfter >= fullW) [side, sideAge] = ['after', true];
    else if (age && spaceBefore >= fullW) [side, sideAge] = ['before', true];
    else if (spaceAfter >= yearsW) side = 'after';
    else if (spaceBefore >= yearsW) side = 'before';
  }
  const inside = side === 'inside';

  const cls = ['tl-row', selected && 'is-selected', compared && 'is-compared', muted && 'is-muted']
    .filter(Boolean)
    .join(' ');
  const fill = [
    'tl-bar-fill',
    !span.startKnown && 'is-fade-start',
    !span.endKnown && 'is-fade-end',
    span.living && 'is-living',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      role="listitem"
      style={{ top, height }}
      data-person-id={p.id}
      onClick={(e) => onPick(p.id, e)}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest('.tl-event, .tl-pin')) onEdit(p.id);
      }}
    >
      <button
        type="button"
        className="tl-name"
        style={{ width: nameW }}
        aria-pressed={selected}
        aria-label={`${displayName(p)}, ${years}${relation ? `, ${relation}` : ''}`}
        tabIndex={tabbable ? 0 : -1}
      >
        <Avatar person={p} size={compact ? 24 : 28} />
        <span className="tl-name-text">
          <span className="tl-name-main">
            <span className="tl-name-full">{compact ? shortName(p) : displayName(p)}</span>
            {isHome && <House size={12} className="tl-home" aria-label="You" />}
          </span>
          {relation && <span className="tl-name-sub">{relation}</span>}
        </span>
      </button>
      <div className="tl-track" style={{ width: trackW }}>
        <div className={`tl-bar g-${p.gender}`} style={{ left, width: barW }} aria-hidden="true">
          <div className={fill} />
          {overlap && (
            // The overlapping stretch, cut from a full-strength copy of the bar so its ends line up.
            <div className="tl-bar-lit" style={{ left: overlap.left, width: overlap.width }}>
              <div className={fill} style={{ left: -overlap.left, width: barW }} />
            </div>
          )}
          {inside && (
            <span className="tl-bar-label" style={{ paddingLeft: inset }}>
              {years}
              {fitsAge && <span className="tl-bar-age">{age}</span>}
            </span>
          )}
          {pins.map((pin, i) => {
            const one = pin.births.length === 1 ? pin.births[0].child : null;
            const linked = pin.births.some((b) => linkedChildIds.has(b.child.id));
            return (
              <span
                key={i}
                data-pin={i}
                className={`tl-pin${one ? ` g-${one.gender}` : ' is-group'}${linked ? ' is-linked' : ''}`}
                style={{ left: pin.x }}
              >
                {!one && pin.births.length}
              </span>
            );
          })}
        </div>
        {!inside && (
          <span
            className="tl-bar-label is-outside"
            style={side === 'after' ? { left: left + barW + 8 } : { right: trackW - left + 8 }}
            aria-hidden="true"
          >
            {years}
            {sideAge && <span className="tl-bar-age">{age}</span>}
          </span>
        )}

        {events.length > 0 && (
          <ul className="tl-events" aria-label={`Events in ${shortName(p)}'s life`}>
            {events.map((ev, i) => (
              <li key={ev.key}>
                <span className="tl-event-mark" style={{ left: ev.x }} />
                <span
                  className="tl-event-stem"
                  style={{ left: ev.x, height: EVENTS_GAP + ev.lane * LANE_H + 12 }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="tl-event"
                  data-event={i}
                  style={{ left: ev.left, top: BAR_TOP + BAR_H + EVENTS_GAP + ev.lane * LANE_H }}
                  aria-label={`${ev.label}, ${formatDate(ev.date)}`}
                >
                  <Avatar person={ev.person} size={20} />
                  <span className="tl-event-text">{ev.label}</span>
                  <span className="tl-event-year">{ev.year}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

/** What the hover card is showing, anchored in viewport coordinates. */
type Tip =
  | { kind: 'person'; id: string; x: number; top: number; bottom: number }
  | { kind: 'event'; index: number; left: number; right: number; top: number; bottom: number }
  | { kind: 'births'; parentId: string; pin: number; left: number; right: number; top: number; bottom: number };

export function Timeline() {
  const tree = useStore((s) => s.tree);
  const selectedId = useStore((s) => s.selectedId);
  const compareId = useStore((s) => s.compareId);
  const focus = useStore((s) => s.focus);
  const view = useStore((s) => s.view);
  const panelOpen = useStore((s) => Boolean(s.selectedId && s.tree.people[s.selectedId]));
  const select = useStore((s) => s.select);

  const [order, setOrderState] = useState<TimelineOrder>(loadOrder);
  const setOrder = (o: TimelineOrder) => {
    setOrderState(o);
    try {
      localStorage.setItem(ORDER_KEY, o);
    } catch {
      /* order just won't persist */
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null); // px per year; null = fit to width
  const [hover, setHover] = useState<{ year: number; row: string | null } | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const now = useMemo(() => nowYear(), []);
  const naming = useStore((s) => s.naming);
  const kin = relationLabels(tree, naming);

  // A focused branch narrows the timeline too; folded branches are a tree-only thing.
  const ids = useMemo(
    () => (focus && tree.people[focus.id] ? focusSet(tree, focus) : Object.keys(tree.people)),
    [tree, focus],
  );
  const { rows, undated, min, max } = useMemo(() => timelineRows(tree, ids, order, now), [tree, ids, order, now]);
  const rowIndex = useMemo(() => new Map(rows.map((s, i) => [s.person.id, i])), [rows]);

  const compact = viewportW > 0 && viewportW < 600;
  const nameW = compact ? 124 : 232;
  const from = Math.floor((min - 1) / 5) * 5;
  const to = Math.ceil((max + 1) / 5) * 5;
  const years = Math.max(to - from, 1);
  const fitPpy = Math.min(MAX_PPY, Math.max(MIN_PPY, (viewportW - nameW - PAD * 2 - 2) / years));
  const ppy = zoom ?? fitPpy;
  const trackW = Math.ceil(years * ppy + PAD * 2);
  const xOf = useCallback((year: number) => PAD + (year - from) * ppy, [from, ppy]);
  const yearAt = (trackX: number) => from + (trackX - PAD) / ppy;
  const { ticks } = useMemo(() => axisTicks(from, to, ppy), [from, to, ppy]);
  const lifetimes = useMemo(() => indexLifetimes(rows), [rows]);

  const selIndex = selectedId ? rowIndex.get(selectedId) : undefined;
  const sel = selIndex !== undefined ? rows[selIndex] : null;
  const cmp = compareId && rowIndex.has(compareId) ? rows[rowIndex.get(compareId)!] : null;

  // --- The selected person's life events ------------------------------------------------
  // Their children being born, and their parents and partners dying, each as a labelled chip
  // under their bar. Chips that would overlap move down a lane.
  const life = useMemo(() => {
    if (!sel) return { events: [] as LifeEvent[], extra: 0 };
    const p = sel.person;
    const spanOf = (id: string) => {
      const i = rowIndex.get(id);
      return i === undefined ? null : rows[i];
    };
    const within = (at: number) => at >= sel.start && at <= sel.end;
    const found: (Omit<LifeEvent, 'key' | 'year' | 'age' | 'x' | 'left' | 'lane'> & { at: number })[] = [];

    for (const c of childrenOf(tree, p.id)) {
      const s = spanOf(c.id);
      if (!s?.startKnown || !within(s.start)) continue;
      const role = byGender(c, 'son', 'daughter', 'child');
      found.push({ person: c, at: s.start, kind: 'born', role, label: `${shortName(c)} born`, date: c.birthDate });
    }
    const died = (q: Person, role: string) => {
      const s = spanOf(q.id);
      if (!s || s.living || !s.endKnown || !q.deathDate || !within(s.end)) return;
      found.push({ person: q, at: s.end, kind: 'died', role, label: `${shortName(q)} died`, date: q.deathDate });
    };
    for (const q of parentsOf(tree, p.id)) died(q, byGender(q, 'father', 'mother', 'parent'));
    for (const { person: q, union } of partnersOf(tree, p.id)) {
      const role =
        union.status === 'married'
          ? byGender(q, 'husband', 'wife', 'partner')
          : union.status === 'divorced'
            ? 'former partner'
            : 'partner';
      died(q, role);
    }

    const laneEnds: number[] = [];
    const events = found
      .sort((a, b) => a.at - b.at)
      .map((f): LifeEvent => {
        const year = Math.floor(f.at);
        const x = xOf(f.at);
        const w = textWidth(`${f.label} ${year}`) + 44;
        const left = Math.max(2, Math.min(x - 13, trackW - w - 2));
        let lane = laneEnds.findIndex((end) => left >= end + 8);
        if (lane < 0) lane = laneEnds.push(0) - 1;
        laneEnds[lane] = left + w;
        return { key: `${f.person.id}-${f.kind}`, ...f, year, age: ageAt(sel, f.at), x, left, lane };
      });
    const extra = events.length ? EVENTS_GAP + laneEnds.length * LANE_H + 4 : 0;
    return { events, extra };
  }, [sel, tree, rows, rowIndex, xOf, trackW]);

  const extra = life.extra;
  const rowTop = useCallback(
    (i: number) => i * ROW_H + (selIndex !== undefined && i > selIndex ? extra : 0),
    [selIndex, extra],
  );
  const rowHeight = useCallback((i: number) => ROW_H + (i === selIndex ? extra : 0), [selIndex, extra]);
  /** The row at this height in the list (rows after the selected one sit `extra` lower). */
  const rowAt = useCallback(
    (y: number) => {
      const i = Math.floor(y / ROW_H);
      return selIndex !== undefined && i > selIndex ? Math.max(selIndex, Math.floor((y - extra) / ROW_H)) : i;
    },
    [selIndex, extra],
  );

  // --- Which rows are drawn -------------------------------------------------------------
  // Only rows in (or near) the scrolled-to part of the list are in the page. The band is
  // widened past the screen so a scroll only re-renders once it leaves the band.
  const [band, setBand] = useState({ top: 0, bottom: 1200 });
  const syncBand = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    setBand((b) => (top >= b.top && bottom <= b.bottom ? b : { top: top - BAND_MARGIN, bottom: bottom + BAND_MARGIN }));
  }, []);

  // Latest values for effects and event handlers that shouldn't re-subscribe on every render.
  const live = useRef({
    rows,
    rowIndex,
    nameW,
    xOf,
    ppy,
    yearAt,
    rowTop,
    rowHeight,
    events: life.events,
    pins: new Map<string, Pin[]>(),
  });
  live.current = { ...live.current, rows, rowIndex, nameW, xOf, ppy, yearAt, rowTop, rowHeight, events: life.events };

  // --- Hover card -----------------------------------------------------------------
  const tipTimer = useRef(0);
  const tipKey = useRef('');
  /** Until when moving onto another bar opens its card at once (the cards are "warm"). */
  const warmUntil = useRef(0);
  const pointerX = useRef(0);
  const hideTip = useCallback(() => {
    window.clearTimeout(tipTimer.current);
    tipKey.current = '';
    setTip((t) => {
      if (t) warmUntil.current = performance.now() + 300;
      return null;
    });
  }, []);
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  // The anchor moves when the layout does.
  useEffect(hideTip, [rows, ppy, nameW, sel, hideTip]);

  const trackTip = (target: HTMLElement, clientX: number) => {
    pointerX.current = clientX;
    const evEl = target.closest<HTMLElement>('.tl-event');
    const pinEl = evEl ? null : target.closest<HTMLElement>('.tl-pin');
    const barEl = evEl || pinEl ? null : target.closest<HTMLElement>('.tl-bar');
    const el = evEl ?? pinEl ?? barEl;
    const rowId = el?.closest<HTMLElement>('.tl-row')?.dataset.personId;
    const key = rowId
      ? evEl
        ? `ev:${rowId}:${evEl.dataset.event}`
        : pinEl
          ? `pin:${rowId}:${pinEl.dataset.pin}`
          : `bar:${rowId}`
      : '';
    if (key === tipKey.current) return;

    window.clearTimeout(tipTimer.current);
    const wasOpen = tip !== null || performance.now() < warmUntil.current;
    tipKey.current = key;
    setTip(null);
    if (!key || !rowId) return;
    const show = () => {
      const r = el!.getBoundingClientRect();
      if (pinEl) {
        setTip({ kind: 'births', parentId: rowId, pin: Number(pinEl.dataset.pin), left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      } else if (evEl) {
        setTip({ kind: 'event', index: Number(evEl.dataset.event), left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      } else {
        setTip({ kind: 'person', id: rowId, x: pointerX.current, top: r.top, bottom: r.bottom });
      }
    };
    // Event chips already say what happened, so their card (the extra detail) comes quickly.
    if (wasOpen || evEl || pinEl) show();
    else tipTimer.current = window.setTimeout(show, TIP_DELAY);
  };

  // --- Measuring & zoom --------------------------------------------------------
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => {
      setViewportW(el.clientWidth);
      syncBand();
    });
    ro.observe(el);
    setViewportW(el.clientWidth);
    syncBand();
    return () => ro.disconnect();
  }, [syncBand]);

  // Zooming keeps the year under the cursor (or the middle of the view) where it was.
  const anchor = useRef<{ year: number; v: number } | null>(null);
  const zoomTo = useCallback((next: number | null, v?: number) => {
    const el = scrollRef.current!;
    const { nameW: nw, yearAt: ya } = live.current;
    const at = v ?? nw + (el.clientWidth - nw) / 2;
    anchor.current = { year: ya(at - nw + el.scrollLeft), v: at };
    setZoom(next === null ? null : Math.min(MAX_PPY, Math.max(MIN_PPY, next)));
  }, []);
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const el = scrollRef.current!;
    el.scrollLeft = nameW + xOf(a.year) - a.v;
  }, [ppy, nameW, xOf]);

  const zoomBy = useCallback(
    (factor: number, v?: number) => zoomTo(live.current.ppy * factor, v),
    [zoomTo],
  );
  const zoomed = useRef(false);
  zoomed.current = zoom !== null;
  const fit = useCallback(() => {
    if (zoomed.current) zoomTo(null);
  }, [zoomTo]);

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms the time axis.
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const v = e.clientX - el.getBoundingClientRect().left;
      zoomBy(Math.exp(-e.deltaY * 0.0025), Math.max(live.current.nameW, v));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // --- Scrolling people into view -----------------------------------------------
  const revealRow = useCallback((id: string, how: 'center' | 'nearest', smooth: boolean) => {
    const el = scrollRef.current;
    const { rowIndex: ri, rows: rs, nameW: nw, xOf: x, rowTop: topOf, rowHeight: heightOf } = live.current;
    const i = ri.get(id);
    if (!el || i === undefined) return;
    const top = topOf(i); // in scroll coordinates the axis sits above row 0
    const h = heightOf(i);
    // On narrow screens the details panel is a sheet over the bottom of the timeline.
    let visibleH = el.clientHeight - AXIS_H;
    const panel = document.querySelector('.panel')?.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (panel && panel.width > box.width * 0.6 && panel.top < box.bottom) {
      visibleH = Math.max(ROW_H * 2, panel.top - box.top - AXIS_H - 8);
    }
    let scrollTop = el.scrollTop;
    if (how === 'center') scrollTop = top - Math.max(0, (visibleH - h) / 2);
    else if (top < el.scrollTop) scrollTop = top - ROW_H;
    else if (top + h > el.scrollTop + visibleH) scrollTop = top + h + ROW_H - visibleH;

    const span = rs[i];
    const barX = nw + x(span.start);
    let scrollLeft = el.scrollLeft;
    if (barX - el.scrollLeft < nw + 16 || barX - el.scrollLeft > el.clientWidth - 80) scrollLeft = barX - nw - 48;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({
      top: Math.max(0, scrollTop),
      left: Math.max(0, scrollLeft),
      behavior: smooth && !still ? 'smooth' : 'auto',
    });
  }, []);

  // Requests from search, the details panel, "go home" and so on.
  useEffect(() => {
    if (view.kind === 'fit') {
      fit();
      return;
    }
    if (!view.id) return;
    const id = view.id;
    const how = view.kind === 'focus' ? 'center' : 'nearest';
    // Wait a tick so a freshly mounted timeline has measured itself (and the panel opened).
    const timer = window.setTimeout(() => revealRow(id, how, true), 0);
    return () => window.clearTimeout(timer);
  }, [view, fit, revealRow]);

  // Keep the selected row's button focusable so keyboard users land on it.
  useEffect(() => {
    if (!selectedId) return;
    const btn = scrollRef.current?.querySelector<HTMLButtonElement>(`[data-person-id="${selectedId}"] .tl-name`);
    if (btn && document.activeElement?.closest('.tl-scroll')) btn.focus({ preventScroll: true });
  }, [selectedId]);

  // --- Keyboard ------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const { dialog, selectedId: current, tree: t, select: pick } = useStore.getState();
      const el = e.target as HTMLElement;
      if (dialog || el.closest('input, textarea, select, [role="menu"]')) return;

      const key = e.key.toLowerCase();
      if (key === 'f') return fit();
      if (key === 'h') return void (t.homeId && pick(t.homeId, true));
      if (key === '+' || key === '=') return zoomBy(ZOOM_STEP);
      if (key === '-') return zoomBy(1 / ZOOM_STEP);
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      e.preventDefault();
      const { rows: rs, rowIndex: ri } = live.current;
      if (rs.length === 0) return;
      const i = current ? ri.get(current) : undefined;
      if (i === undefined) {
        const start = t.homeId && ri.has(t.homeId) ? t.homeId : rs[0].person.id;
        pick(start);
        return;
      }
      const next = rs[Math.min(rs.length - 1, Math.max(0, i + (e.key === 'ArrowUp' ? -1 : 1)))];
      if (next) pick(next.person.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, zoomBy]);

  // --- Selection & overlap ---------------------------------------------------------
  const onPick = useCallback(
    (id: string, e: MouseEvent) => {
      e.stopPropagation();
      hideTip();
      const { select: pick, compare, selectedId: current } = useStore.getState();
      // An event chip goes to the person it happened to.
      // An event chip or a birth dot goes to the person it's about.
      const t = e.target as HTMLElement;
      const evEl = t.closest<HTMLElement>('.tl-event');
      const pinEl = t.closest<HTMLElement>('.tl-pin');
      const other = evEl
        ? live.current.events[Number(evEl.dataset.event)]?.person.id
        : pinEl
          ? live.current.pins.get(id)?.[Number(pinEl.dataset.pin)]?.births[0].child.id
          : undefined;
      const target = other ?? id;
      if (e.shiftKey) compare(target);
      else if (target !== current) pick(target, Boolean(other));
    },
    [hideTip],
  );
  const onEdit = useCallback((id: string) => useStore.getState().openDialog({ type: 'edit', personId: id }), []);

  // Children's births, as dots on their parents' bars (births close together share one dot).
  const pins = useMemo(() => {
    const births = new Map<string, { at: number; birth: Birth }[]>();
    for (const child of rows) {
      if (!child.startKnown) continue;
      for (const pid of child.person.parentIds) {
        const i = rowIndex.get(pid);
        if (i === undefined) continue;
        const parent = rows[i];
        if (child.start < parent.start || child.start > parent.end) continue;
        const list = births.get(pid) ?? [];
        list.push({ at: child.start, birth: { child: child.person, parentAge: ageAt(parent, child.start) } });
        births.set(pid, list);
      }
    }
    const out = new Map<string, Pin[]>();
    for (const [pid, list] of births) {
      const start = rows[rowIndex.get(pid)!].start;
      const pinsFor: Pin[] = [];
      for (const { at, birth } of list.sort((a, b) => a.at - b.at)) {
        const x = (at - start) * ppy;
        const last = pinsFor[pinsFor.length - 1];
        if (last && x - last.x < PIN_GAP) last.births.push(birth);
        else pinsFor.push({ x, births: [birth] });
      }
      out.set(pid, pinsFor);
    }
    return out;
  }, [rows, rowIndex, ppy]);
  live.current.pins = pins;

  // The selected person and their children: the dots that belong to the family lines.
  const linked = useMemo(() => {
    const set = new Set<string>();
    if (!sel) return set;
    set.add(sel.person.id);
    for (const c of childrenOf(tree, sel.person.id)) set.add(c.id);
    return set;
  }, [sel, tree]);

  // Lines from each parent's birth dot down to the selected person, and from them to each child,
  // each labelled with how old the parent was.
  const links = useMemo(() => {
    if (!sel || selIndex === undefined) return [];
    const out: { key: string; x: number; from: number; to: number; text: string | null }[] = [];
    const was = (parent: Span, at: number) => {
      const age = ageAt(parent, at);
      return age === null ? null : `${shortName(parent.person)} was ${age}`;
    };
    if (sel.startKnown) {
      for (const pid of sel.person.parentIds) {
        const i = rowIndex.get(pid);
        if (i === undefined || sel.start > rows[i].end || sel.start < rows[i].start) continue;
        out.push({ key: `p-${pid}`, x: xOf(sel.start), from: i, to: selIndex, text: was(rows[i], sel.start) });
      }
    }
    for (const child of rows) {
      if (!child.startKnown || !child.person.parentIds.includes(sel.person.id) || child.start > sel.end) continue;
      const i = rowIndex.get(child.person.id)!;
      out.push({ key: `c-${child.person.id}`, x: xOf(child.start), from: selIndex, to: i, text: was(sel, child.start) });
    }
    return out;
  }, [sel, selIndex, rows, rowIndex, xOf]);

  const overlapping = useMemo(
    () => (sel ? rows.filter((s) => s !== sel && overlapYears(sel, s) > 0).length : 0),
    [sel, rows],
  );

  // The rows in the drawn band, plus the selected and compared people's wherever they are
  // (so keyboard focus and the comparison always have a row to land on).
  const first = Math.max(0, rowAt(band.top));
  const last = Math.min(rows.length - 1, rowAt(band.bottom));
  const cmpIndex = cmp ? rowIndex.get(cmp.person.id) : undefined;

  // Built once per change (not per mouse move) so the memoised rows can skip re-rendering.
  const homeId = tree.homeId;
  const rowProps = useMemo(() => {
    const drawn: number[] = [];
    for (const i of [selIndex, cmpIndex]) if (i !== undefined && (i < first || i > last)) drawn.push(i);
    for (let i = first; i <= last; i++) drawn.push(i);
    return drawn.map((i): RowProps => {
        const s = rows[i];
        const isSel = s === sel;
        let overlap: RowProps['overlap'] = null;
        if (sel && !isSel) {
          const a = Math.max(sel.start, s.start);
          const b = Math.min(sel.end, s.end);
          if (b > a) overlap = { left: (a - s.start) * ppy, width: (b - a) * ppy };
        }
        return {
          span: s,
          nameW,
          trackW,
          top: rowTop(i),
          height: rowHeight(i),
          left: xOf(s.start),
          width: (s.end - s.start) * ppy,
          selected: isSel,
          compared: s === cmp,
          tabbable: isSel || (!sel && i === 0),
          isHome: s.person.id === homeId,
          muted: Boolean(sel) && !isSel && s !== cmp,
          overlap,
          relation: kin.get(s.person.id) ?? '',
          events: isSel ? life.events : NO_EVENTS,
          // The selected row shows its children's births as labelled events instead.
          pins: isSel ? NO_PINS : (pins.get(s.person.id) ?? NO_PINS),
          linkedChildIds: sel && sel.person.parentIds.includes(s.person.id) ? linked : NO_IDS,
          compact,
          onPick,
          onEdit,
        };
      });
  }, [rows, sel, selIndex, cmp, cmpIndex, first, last, homeId, kin, ppy, nameW, trackW, xOf, rowTop, rowHeight, life, pins, linked, compact, onPick, onEdit]);

  // --- Hover readout -----------------------------------------------------------------
  const readout = (clientX: number, target: HTMLElement) => {
    const el = scrollRef.current!;
    const v = clientX - el.getBoundingClientRect().left;
    if (v < nameW) return setHover(null);
    const year = yearAt(v - nameW + el.scrollLeft);
    if (year < from || year > to) return setHover(null);
    setHover({ year, row: target.closest<HTMLElement>('.tl-row')?.dataset.personId ?? null });
  };
  const readoutRef = useRef(readout);
  readoutRef.current = readout;
  const hoverFrame = useRef(0);
  const pendingHover = useRef<{ x: number; target: HTMLElement } | null>(null);
  const cancelHover = useCallback(() => {
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = 0;
    pendingHover.current = null;
  }, []);
  useEffect(() => cancelHover, [cancelHover, rows, ppy, nameW]);
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return; // a finger here is scrolling
    pendingHover.current = { x: e.clientX, target: e.target as HTMLElement };
    if (!hoverFrame.current) hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      const pending = pendingHover.current;
      pendingHover.current = null;
      if (pending) readoutRef.current(pending.x, pending.target);
    });
    trackTip(e.target as HTMLElement, e.clientX);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      cancelHover();
      readout(e.clientX, e.target as HTMLElement);
    }
  };
  const onLeave = () => {
    cancelHover();
    setHover(null);
    hideTip();
  };

  const hoverYear = hover?.year ?? null;
  const alive = hoverYear !== null ? countAlive(lifetimes, hoverYear) : 0;
  // Everyone's age at the year under the pointer (only rows on screen are drawn).
  const hoverAges = useMemo(() => {
    const el = scrollRef.current;
    if (hoverYear === null || !el) return [];
    const top = el.scrollTop - ROW_H;
    const bottom = el.scrollTop + el.clientHeight;
    const out: { i: number; age: number }[] = [];
    const first = Math.max(0, rowAt(top));
    const last = Math.min(rows.length - 1, rowAt(bottom));
    for (let i = first; i <= last; i++) {
      const y = rowTop(i);
      if (y < top || y > bottom) continue;
      const age = ageAt(rows[i], hoverYear);
      if (age !== null) out.push({ i, age });
    }
    return out;
  }, [hoverYear, rows, rowTop, rowAt, band]);

  const home = tree.homeId ? tree.people[tree.homeId] : undefined;
  const bodyH = rows.length * ROW_H + extra;
  const nowX = xOf(now);
  const comparing = sel && cmp && cmp !== sel ? cmp : null;

  return (
    <section className={`timeline${panelOpen ? ' is-panel-open' : ''}`} aria-label="Family timeline">
      <div className="tl-toolbar">
        <div className="segmented tl-order" role="radiogroup" aria-label="Order people">
          <button type="button" role="radio" aria-checked={order === 'birth'} onClick={() => setOrder('birth')}>
            Oldest first
          </button>
          <button type="button" role="radio" aria-checked={order === 'family'} onClick={() => setOrder('family')}>
            By family
          </button>
        </div>

        <div className="tl-status" aria-live="polite">
          {sel ? (
            <>
              <span className="tl-focus">
                <span className="tl-focus-avatars">
                  <Avatar person={sel.person} size={24} />
                  {comparing && <Avatar person={comparing.person} size={24} />}
                </span>
                <span className="tl-focus-text">
                  {comparing ? (
                    <CompareText base={sel} other={comparing} />
                  ) : (
                    <>
                      <strong>{shortName(sel.person)}</strong>
                      <span className="tl-focus-detail">
                        lived alongside {overlapping} of {countPeople(rows.length - 1)}
                      </span>
                    </>
                  )}
                </span>
                <button
                  type="button"
                  className="tl-focus-clear"
                  onClick={() => select(null)}
                  aria-label="Clear selection"
                  data-tip="Clear (Esc)"
                >
                  <X size={14} />
                </button>
              </span>
            </>
          ) : null}
        </div>

        {!sel && rows.length > 0 && (
          <div className="tl-legend" aria-hidden="true">
            <span>
              <span className="tl-key-pin" /> Child born
            </span>
            <span>
              <span className="tl-key-fade" /> Date unknown
            </span>
          </div>
        )}

        <div className="control-group tl-zoom">
          <button
            type="button"
            className="icon-btn"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            disabled={ppy <= MIN_PPY}
            aria-label="Zoom out"
            data-tip="Zoom out (−)"
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => zoomBy(ZOOM_STEP)}
            disabled={ppy >= MAX_PPY}
            aria-label="Zoom in"
            data-tip="Zoom in (+)"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={fit}
            disabled={zoom === null}
            aria-label="Fit all years"
            data-tip="Fit all years (F)"
          >
            <Maximize size={15} />
          </button>
          {home && rowIndex.has(home.id) && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => select(home.id, true)}
              aria-label={`Go to ${shortName(home)}, the home person`}
              data-tip={`Go to ${shortName(home)} (H)`}
            >
              <House size={15} />
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="tl-scroll"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerLeave={onLeave}
        onScroll={() => {
          syncBand();
          if (tip) hideTip();
        }}
        onClick={() => select(null)}
      >
        {rows.length === 0 ? (
          <div className="tl-empty">
            <CalendarPlus size={28} />
            <h2>Nobody has dates yet</h2>
            <p>Add a birth year (or a year of death) to someone and they'll appear here, on a line through time.</p>
          </div>
        ) : (
          <div className="tl-grid" style={{ width: nameW + trackW, paddingBottom: BOTTOM_ROOM }}>
            <div className="tl-axis" style={{ height: AXIS_H }}>
              <div className="tl-corner" style={{ width: nameW }}>
                {countPeople(rows.length)}
              </div>
              <div className="tl-axis-track" style={{ width: trackW }}>
                {/* Years the "Today" label would sit on are left out. */}
                {ticks.map((t) => (
                  <span
                    key={t.year}
                    className={`tl-tick${t.major ? ' is-major' : ''}${!hover && Math.abs(xOf(t.year) - nowX) < 36 ? ' is-hidden' : ''}`}
                    style={{ left: xOf(t.year) }}
                  >
                    {t.year}
                  </span>
                ))}
                {nowX <= trackW && (
                  <span className={`tl-now-label${hover ? ' is-hidden' : ''}`} style={{ left: nowX }}>
                    Today
                  </span>
                )}
                {hover && (
                  <span className="tl-cursor-label" style={{ left: xOf(hover.year) }}>
                    {Math.floor(hover.year)}
                    <span>{alive} alive</span>
                  </span>
                )}
              </div>
            </div>

            <div className="tl-body" role="list" style={{ height: bodyH }}>
              <div className="tl-layer" style={{ left: nameW, width: trackW }} aria-hidden="true">
                {ticks.map((t) => (
                  <span key={t.year} className={`tl-grid-line${t.major ? ' is-major' : ''}`} style={{ left: xOf(t.year) }} />
                ))}
                {sel && (
                  <span
                    className="tl-band"
                    style={{ left: xOf(sel.start), width: Math.max(2, xOf(sel.end) - xOf(sel.start)) }}
                  />
                )}
                <span className="tl-now" style={{ left: nowX }} />
                {links.length > 0 && (
                  <svg className="tl-links" width={trackW} height={bodyH}>
                    {links.map((l) => {
                      // From the bottom of the parent's bar (where the birth dot sits) to the child's bar.
                      const down = l.to > l.from;
                      const y1 = rowTop(l.from) + BAR_TOP + (down ? BAR_H : 0);
                      const y2 = rowTop(l.to) + BAR_TOP + (down ? 0 : BAR_H);
                      const d = down ? 1 : -1;
                      return (
                        <g key={l.key}>
                          <line x1={l.x} x2={l.x} y1={y1 + 6 * d} y2={y2 - 3 * d} />
                          <path d={`M${l.x - 4},${y2 - 7 * d} L${l.x},${y2 - 2 * d} L${l.x + 4},${y2 - 7 * d}`} />
                        </g>
                      );
                    })}
                  </svg>
                )}
              </div>

              {rowProps.map((props) => (
                <TimelineRow key={props.span.person.id} {...props} />
              ))}

              {links.some((l) => l.text) && (
                <div className="tl-layer is-front" style={{ left: nameW, width: trackW }} aria-hidden="true">
                  {links.map(
                    (l) =>
                      l.text && (
                        <span
                          key={l.key}
                          className="tl-link-age"
                          // Beside the other person's bar (each parent's, each child's), so labels
                          // never stack up on the selected row.
                          style={{
                            left: l.x + 7,
                            top:
                              (l.from === selIndex ? l.to : l.from) === Math.min(l.from, l.to)
                                ? rowTop(Math.min(l.from, l.to)) + BAR_TOP + BAR_H + 3
                                : rowTop(Math.max(l.from, l.to)) + BAR_TOP - 19,
                          }}
                        >
                          {l.text}
                        </span>
                      ),
                  )}
                </div>
              )}

              {hover && (
                <div className="tl-layer is-front" style={{ left: nameW, width: trackW }} aria-hidden="true">
                  <span className="tl-cursor" style={{ left: xOf(hover.year) }} />
                  {hoverAges.map(({ i, age }) => (
                    <span
                      key={i}
                      className={`tl-age${rows[i].person.id === hover.row ? ' is-current' : ''}`}
                      style={{ left: xOf(hover.year) + 7, top: rowTop(i) + BAR_TOP + BAR_H / 2 }}
                    >
                      {age}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {undated.length > 0 && (
        <div className="tl-undated">
          <span className="tl-undated-title">
            {countPeople(undated.length)} without dates
          </span>
          <ul className="tl-undated-list">
            {undated.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`tl-chip${p.id === selectedId ? ' is-selected' : ''}`}
                  data-person-id={p.id}
                  onClick={() => select(p.id)}
                  onDoubleClick={() => onEdit(p.id)}
                >
                  <Avatar person={p} size={22} />
                  {displayName(p)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tip && (
        <HoverCard
          tip={tip}
          rows={rows}
          rowIndex={rowIndex}
          events={life.events}
          pins={pins}
          sel={sel}
          relationOf={(id) => kin.get(id) ?? ''}
          childCount={(id) => childrenOf(tree, id).length}
        />
      )}
    </section>
  );
}

/** "Kiran and Raj were both alive from 1988 to 2010" and the like. */
function CompareText({ base, other }: { base: Span; other: Span }) {
  const a = <strong>{shortName(base.person)}</strong>;
  const b = <strong>{shortName(other.person)}</strong>;
  const t = together(base, other);
  if (t.kind === 'overlap') {
    return (
      <span className="tl-focus-detail">
        {a} and {b} {t.ongoing ? 'have both been' : 'were both'} alive {togetherWhen(t)}
      </span>
    );
  }
  if (t.kind === 'unknown') {
    return (
      <span className="tl-focus-detail">
        {a} and {b} were probably never alive at the same time
      </span>
    );
  }
  return (
    <span className="tl-focus-detail">
      {b} {t.otherLater ? 'was born' : 'died'} {yearsText(t.years)} {t.otherLater ? 'after' : 'before'} {a}{' '}
      {t.otherLater ? 'died' : 'was born'}
    </span>
  );
}

interface HoverCardProps {
  tip: Tip;
  rows: Span[];
  rowIndex: Map<string, number>;
  events: LifeEvent[];
  pins: Map<string, Pin[]>;
  sel: Span | null;
  relationOf: (id: string) => string;
  childCount: (id: string) => number;
}

/** A floating card with the details behind a bar or a life event. */
function HoverCard({ tip, rows, rowIndex, events, pins, sel, relationOf, childCount }: HoverCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Placed once its size is known: a person's card sits beside the pointer, an event's beside its chip.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 10;
    let left: number;
    let top: number;
    if (tip.kind === 'person') {
      left = tip.x - w - 16;
      if (left < margin) left = tip.x + 24;
      top = (tip.top + tip.bottom) / 2 - h / 2;
    } else {
      // Beside the chip (right of it, else left), so it never half-covers the chips below.
      left = tip.right + 10;
      if (left + w > vw - margin) left = tip.left - w - 10;
      top = (tip.top + tip.bottom) / 2 - h / 2;
    }
    el.style.left = `${Math.round(Math.min(Math.max(margin, left), vw - w - margin))}px`;
    el.style.top = `${Math.round(Math.min(Math.max(margin, top), vh - h - margin))}px`;
    el.classList.add('is-placed');
  }, [tip]);

  let body: ReactNode = null;
  if (tip.kind === 'person') {
    const i = rowIndex.get(tip.id);
    const span = i !== undefined ? rows[i] : null;
    if (!span) return null;
    const p = span.person;
    const age = ageOf(p);
    const kids = childCount(p.id);
    const relation = relationOf(p.id);
    body = (
      <>
        <div className="tl-card-head">
          <Avatar person={p} size={40} />
          <div>
            {relation && <span className="tl-card-eyebrow">{relation}</span>}
            <strong>{displayName(p)}</strong>
          </div>
        </div>
        <dl className="tl-card-facts">
          <div>
            <dt>Born</dt>
            <dd>
              {formatDate(p.birthDate) || <em>Date not recorded</em>}
              {p.birthPlace && <span className="tl-card-muted"> · {p.birthPlace}</span>}
            </dd>
          </div>
          {span.living ? (
            age !== null && (
              <div>
                <dt>Age</dt>
                <dd>{age}</dd>
              </div>
            )
          ) : (
            <div>
              <dt>Died</dt>
              <dd>
                {formatDate(p.deathDate) || <em>Date not recorded</em>}
                {age !== null && <span className="tl-card-muted"> · aged {age}</span>}
              </dd>
            </div>
          )}
          {kids > 0 && (
            <div>
              <dt>Children</dt>
              <dd>{kids}</dd>
            </div>
          )}
        </dl>
        {sel && sel !== span && (
          <p className="tl-card-foot">
            <AlongsideText base={sel} other={span} />
          </p>
        )}
      </>
    );
  } else if (tip.kind === 'births') {
    const parentIdx = rowIndex.get(tip.parentId);
    const pin = pins.get(tip.parentId)?.[tip.pin];
    if (!pin || parentIdx === undefined) return null;
    const parent = rows[parentIdx].person;
    if (pin.births.length === 1) {
      const { child, parentAge } = pin.births[0];
      body = (
        <EventCard
          person={child}
          kind="born"
          role={byGender(child, 'son', 'daughter', 'child')}
          of={parent}
          date={child.birthDate}
          ofAge={parentAge}
        />
      );
    } else {
      // Births close together (twins, or a zoomed-out view): one line each.
      body = (
        <>
          <div className="tl-card-head">
            <span className="tl-card-badge is-born is-solo" aria-hidden="true">
              <Baby size={16} />
            </span>
            <div>
              <span className="tl-card-eyebrow">{shortName(parent)}'s children</span>
              <strong>{pin.births.length} born close together</strong>
            </div>
          </div>
          <ul className="tl-card-list">
            {pin.births.map(({ child, parentAge }) => (
              <li key={child.id}>
                <Avatar person={child} size={28} />
                <div>
                  <strong>{displayName(child)}</strong>
                  <span>{formatDate(child.birthDate)}</span>
                </div>
                {parentAge !== null && (
                  <span className="tl-card-list-age">
                    {shortName(parent)} was {parentAge}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      );
    }
  } else {
    const ev = events[tip.index];
    if (!ev || !sel) return null;
    body = <EventCard person={ev.person} kind={ev.kind} role={ev.role} of={sel.person} date={ev.date} ofAge={ev.age} />;
  }

  return createPortal(
    <div ref={ref} className="tl-card" role="tooltip">
      {body}
    </div>,
    document.body,
  );
}

interface EventCardProps {
  /** Who was born or died */
  person: Person;
  kind: 'born' | 'died';
  /** Who they were to `of`: "son", "father" */
  role: string;
  /** Whose life this is an event in */
  of: Person;
  date: string;
  /** How old `of` was at the time */
  ofAge: number | null;
}

/** "Peter's father · George Bennett", then when it happened and how old everyone was. */
function EventCard({ person, kind, role, of, date, ofAge }: EventCardProps) {
  const theirAge = kind === 'died' ? ageOf(person) : null;
  return (
    <>
      <div className="tl-card-head">
        <span className="tl-card-avatar">
          <Avatar person={person} size={40} />
          <span className={`tl-card-badge is-${kind}`} aria-hidden="true">
            {kind === 'born' ? <Baby size={11} /> : <Flower2 size={11} />}
          </span>
        </span>
        <div>
          <span className="tl-card-eyebrow">
            {shortName(of)}'s {role}
          </span>
          <strong>{displayName(person)}</strong>
        </div>
      </div>
      <dl className="tl-card-facts">
        <div>
          <dt>{kind === 'born' ? 'Born' : 'Died'}</dt>
          <dd>
            {formatDate(date)}
            {kind === 'born' && person.birthPlace && <span className="tl-card-muted"> · {person.birthPlace}</span>}
          </dd>
        </div>
        {theirAge !== null && (
          <div>
            <dt>Aged</dt>
            <dd>{theirAge}</dd>
          </div>
        )}
        {ofAge !== null && (
          <div>
            <dt>{shortName(of)} was</dt>
            <dd>{ofAge}</dd>
          </div>
        )}
      </dl>
    </>
  );
}

/** "Alive alongside Kiran since 1988", how `other` lines up with the selected person. */
function AlongsideText({ base, other }: { base: Span; other: Span }) {
  const name = <strong>{shortName(base.person)}</strong>;
  const t = together(base, other);
  if (t.kind === 'overlap') {
    return (
      <>
        Alive alongside {name} {togetherWhen(t)}
      </>
    );
  }
  if (t.kind === 'unknown') return <>Probably never alive at the same time as {name}</>;
  return t.otherLater ? (
    <>
      Born {yearsText(t.years)} after {name} died
    </>
  ) : (
    <>
      Died {yearsText(t.years)} before {name} was born
    </>
  );
}

const NO_EVENTS: LifeEvent[] = [];
const NO_PINS: Pin[] = [];
const NO_IDS: ReadonlySet<string> = new Set();
