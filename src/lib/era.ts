/**
 * The family at a given year: who had been born, who was still alive, how old they were.
 * The Descendants fan uses it to grow year by year, the Timeline to write a year's page.
 */
import type { Person } from '../types';
import { ASSUMED_LIFESPAN, spanOf, type Span } from './timeline';

/** How much older than a child a parent is taken to be when neither has a date. */
const GENERATION = 27;

/** The moment a year is read at: its last day, or right now for the year we are in. */
export function momentOf(year: number, now: number): number {
  return Math.min(year + 0.999, now);
}

/**
 * When each person of a family was born and how long they lived, in fractional years, in
 * the order given (parents before their children). A missing birth date is placed a
 * generation after the parent's; someone still living has no end (Infinity).
 */
export function lifetimesOf(
  people: readonly { person: Person; parent: number; depth: number }[],
  now: number,
): { born: number[]; end: number[] } {
  const spans = people.map((n) => spanOf(n.person, now));
  const born: number[] = people.map((_, i) => spans[i]?.start ?? NaN);

  // Nobody to count from at the top: work back from the earliest dated descendant.
  if (people.length && Number.isNaN(born[0])) {
    let top = Infinity;
    people.forEach((n, i) => {
      if (!Number.isNaN(born[i])) top = Math.min(top, born[i] - GENERATION * n.depth);
    });
    born[0] = Number.isFinite(top) ? top : now - GENERATION * 2;
  }
  people.forEach((n, i) => {
    if (Number.isNaN(born[i])) born[i] = Math.min(now, (born[n.parent] ?? born[0]) + GENERATION);
  });

  const end = people.map((n, i) => {
    const s = spans[i];
    if (s) return s.living ? Infinity : s.end;
    return n.person.deceased ? Math.min(now, born[i] + ASSUMED_LIFESPAN) : Infinity;
  });
  return { born, end };
}

export interface AgeBand {
  /** The youngest age in the band: 0, 10, 20 … */
  from: number;
  label: string;
  male: number;
  female: number;
}

export interface YearPage {
  year: number;
  /** Everyone alive when the year closed */
  alive: number;
  /** Ages that year in bands of ten years, eldest first; always the same nine rows */
  bands: AgeBand[];
  /** The longest bar among the bands, for scale */
  widest: number;
  /** Born that year, eldest first */
  born: Person[];
  /** Died that year (only deaths with a known date) */
  died: Person[];
  eldest: { person: Person; age: number } | null;
}

const BAND_STARTS = [80, 70, 60, 50, 40, 30, 20, 10, 0];

/** One year of the family, read off everyone's lifetime. */
export function yearPage(rows: readonly Span[], year: number, now: number): YearPage {
  const t = momentOf(year, now);
  const bands: AgeBand[] = BAND_STARTS.map((from) => ({
    from,
    label: from === 80 ? '80+' : from === 0 ? '0–9' : `${from}s`,
    male: 0,
    female: 0,
  }));
  const born: Span[] = [];
  const died: Person[] = [];
  let alive = 0;
  let eldest: Span | null = null;

  for (const s of rows) {
    if (s.startKnown && Math.floor(s.start) === year) born.push(s);
    if (!s.living && s.endKnown && Math.floor(s.end) === year && s.end <= t) died.push(s.person);
    if (s.start > t || s.end < t) continue;
    alive += 1;
    if (!s.startKnown) continue;
    if (!eldest || s.start < eldest.start) eldest = s;
    const age = Math.floor(t - s.start);
    const band = bands[Math.max(0, 8 - Math.min(8, Math.floor(age / 10)))];
    if (s.person.gender === 'male') band.male += 1;
    else if (s.person.gender === 'female') band.female += 1;
  }

  return {
    year,
    alive,
    bands,
    widest: Math.max(1, ...bands.map((b) => Math.max(b.male, b.female))),
    born: born.sort((a, b) => a.start - b.start).map((s) => s.person),
    died,
    eldest: eldest ? { person: eldest.person, age: Math.floor(t - eldest.start) } : null,
  };
}
