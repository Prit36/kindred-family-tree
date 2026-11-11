import type { Person, Tree } from '../types';
import { compareByBirth, parseDate } from './dates';
import { childrenOf, isPlaceholder, partnersOf } from './tree';

/** How long a life is assumed to last when only one end of it is known. */
export const ASSUMED_LIFESPAN = 75;
/** Past this age someone not marked as deceased is assumed to have died at an unknown date. */
const OLDEST_LIVING = 110;

export type TimelineOrder = 'birth' | 'family';

/** One person's life on the time axis, in fractional years (1990.5 = mid 1990). */
export interface Span {
  person: Person;
  start: number;
  end: number;
  /** False when the birth date is missing and `start` is a guess. */
  startKnown: boolean;
  /** False when someone died at an unknown date (or no birth is known) and `end` is a guess. */
  endKnown: boolean;
  /** Still alive - `end` is today. */
  living: boolean;
}

/** A partial date as a fractional year; a missing month or day counts as the middle of it. */
export function fractionalYear(date: string): number | null {
  const { y, m, d } = parseDate(date);
  if (!y) return null;
  if (!m) return y + 0.5;
  if (!d) return y + (m - 1 + 0.5) / 12;
  return y + (m - 1) / 12 + (d - 1) / 365;
}

export function nowYear(now = new Date()): number {
  const start = new Date(now.getFullYear(), 0, 1).getTime();
  const end = new Date(now.getFullYear() + 1, 0, 1).getTime();
  return now.getFullYear() + (now.getTime() - start) / (end - start);
}

/** Where someone's life sits on the axis, or null when nothing about its dates is known. */
export function spanOf(person: Person, now: number): Span | null {
  const birth = fractionalYear(person.birthDate);
  const death = fractionalYear(person.deathDate);
  if (birth === null && death === null) return null;

  if (birth !== null) {
    if (death !== null) {
      return { person, start: birth, end: Math.max(birth, death), startKnown: true, endKnown: true, living: false };
    }
    if (!person.deceased && now - birth <= OLDEST_LIVING) {
      return { person, start: birth, end: Math.max(birth, now), startKnown: true, endKnown: true, living: true };
    }
    // Died, but nobody knows when.
    return {
      person,
      start: birth,
      end: Math.min(now, birth + ASSUMED_LIFESPAN),
      startKnown: true,
      endKnown: false,
      living: false,
    };
  }
  return { person, start: death! - ASSUMED_LIFESPAN, end: death!, startKnown: false, endKnown: true, living: false };
}

export interface TimelineRows {
  rows: Span[];
  /** People with no dates at all, who can't be placed. */
  undated: Person[];
  /** Earliest and latest point anyone (or today) reaches. */
  min: number;
  max: number;
}

/**
 * Everyone who can be placed on the timeline, in display order.
 *
 * "birth" is simply oldest first. "family" keeps families together: each person is
 * followed by the partners who married into the family, then by their children (and
 * the children's own families), oldest first at every level.
 */
export function timelineRows(tree: Tree, ids: Iterable<string>, order: TimelineOrder, now: number): TimelineRows {
  const people: Person[] = [];
  for (const id of ids) {
    const p = tree.people[id];
    if (p && !isPlaceholder(p)) people.push(p);
  }
  const included = new Set(people.map((p) => p.id));
  const spans = new Map<string, Span>();
  const undated: Person[] = [];
  for (const p of people) {
    const s = spanOf(p, now);
    if (s) spans.set(p.id, s);
    else undated.push(p);
  }

  // Oldest first; people known only by a death date fall where their guessed birth puts them.
  const key = (p: Person) => spans.get(p.id)?.start ?? Number.POSITIVE_INFINITY;
  const byAge = (a: Person, b: Person) => key(a) - key(b) || compareByBirth(a, b);

  let ordered: Person[];
  if (order === 'birth') {
    ordered = [...people].sort(byAge);
  } else {
    ordered = [];
    const seen = new Set<string>();
    const hasParents = (p: Person) => p.parentIds.some((pid) => included.has(pid));
    const visit = (p: Person) => {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      ordered.push(p);
      // Partners with no parents of their own here would otherwise float at the top.
      const partners = partnersOf(tree, p.id)
        .map((x) => x.person)
        .filter((q) => included.has(q.id) && !seen.has(q.id) && !hasParents(q))
        .sort(byAge);
      for (const q of partners) {
        seen.add(q.id);
        ordered.push(q);
      }
      const kids = new Map<string, Person>();
      for (const parent of [p, ...partners]) {
        for (const c of childrenOf(tree, parent.id)) if (included.has(c.id)) kids.set(c.id, c);
      }
      for (const c of [...kids.values()].sort(byAge)) visit(c);
    };
    const sorted = [...people].sort(byAge);
    for (const p of sorted) if (!hasParents(p)) visit(p);
    // Anyone left over (only possible with a loop in the data).
    for (const p of sorted) visit(p);
  }

  const rows = ordered.flatMap((p) => spans.get(p.id) ?? []);
  let min = now;
  let max = now;
  for (const s of rows) {
    min = Math.min(min, s.start);
    max = Math.max(max, s.end);
  }
  return { rows, undated: undated.sort((a, b) => a.firstName.localeCompare(b.firstName)), min, max };
}

/** How long two lives overlapped, in years (0 when they didn't). */
export function overlapYears(a: Span, b: Span): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** True when the overlap of two lives depends on a guessed date. */
export function overlapIsGuess(a: Span, b: Span): boolean {
  const lateStart = a.start >= b.start ? a : b;
  const earlyEnd = a.end <= b.end ? a : b;
  return !lateStart.startKnown || !earlyEnd.endKnown;
}

/** Whole years, the way people say it: "under a year", "1 year", "28 years". */
export function yearsText(years: number): string {
  const n = Math.floor(years + 1e-6);
  if (n < 1) return 'under a year';
  return `${n} ${n === 1 ? 'year' : 'years'}`;
}

/** How two lives lined up in time. */
export type Together =
  /** Both alive from `from` to `to` (each end possibly a guess); `ongoing` when both still are. */
  | { kind: 'overlap'; from: number; to: number; fromGuess: boolean; toGuess: boolean; ongoing: boolean }
  /** Never alive at the same time: `other` was born `years` after `base` died, or died before they were born. */
  | { kind: 'apart'; years: number; otherLater: boolean }
  /** No overlap, but a guessed date means nobody can say how far apart they were. */
  | { kind: 'unknown' };

export function together(base: Span, other: Span): Together {
  const from = Math.max(base.start, other.start);
  const to = Math.min(base.end, other.end);
  if (to > from) {
    const lateStart = base.start >= other.start ? base : other;
    const earlyEnd = base.end <= other.end ? base : other;
    return {
      kind: 'overlap',
      from,
      to,
      fromGuess: !lateStart.startKnown,
      toGuess: !earlyEnd.endKnown,
      ongoing: base.living && other.living,
    };
  }
  if (overlapIsGuess(base, other)) return { kind: 'unknown' };
  const otherLater = other.start >= base.end;
  return { kind: 'apart', years: otherLater ? other.start - base.end : base.start - other.end, otherLater };
}

/** "since 1988", "from 1936 to about 2005", "in 2010" - when two lives overlapped, for a sentence. */
export function togetherWhen(t: Extract<Together, { kind: 'overlap' }>): string {
  const from = `${t.fromGuess ? 'about ' : ''}${Math.floor(t.from)}`;
  if (t.ongoing) return `since ${from}`;
  const to = `${t.toGuess ? 'about ' : ''}${Math.floor(t.to)}`;
  if (Math.floor(t.from) === Math.floor(t.to)) return `in ${to}`;
  return `from ${from} to ${to}`;
}

/** Age in whole years at a moment, or null when the birth date is only a guess or not reached. */
export function ageAt(span: Span, year: number): number | null {
  if (!span.startKnown || year < span.start || year > span.end) return null;
  return Math.floor(year - span.start + 1e-6);
}

export interface Tick {
  year: number;
  major: boolean;
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];

/** Axis ticks that stay at least `minGap` pixels apart. */
export function axisTicks(from: number, to: number, pxPerYear: number, minGap = 64): { ticks: Tick[]; step: number } {
  const step = STEPS.find((s) => s * pxPerYear >= minGap) ?? 1000;
  // Every 5th labelled step (or each century) is drawn a little stronger.
  const major = step >= 50 ? step * 2 : step >= 10 ? 100 : step * 5;
  const ticks: Tick[] = [];
  for (let y = Math.ceil(from / step) * step; y <= to; y += step) ticks.push({ year: y, major: y % major === 0 });
  return { ticks, step };
}
