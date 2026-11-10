import type { Person } from '../types';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface DateParts {
  y: number | null;
  m: number | null;
  d: number | null;
}

export function parseDate(s: string): DateParts {
  const m = /^(\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s ?? '');
  if (!m) return { y: null, m: null, d: null };
  return {
    y: Number(m[1]),
    m: m[2] ? Number(m[2]) : null,
    d: m[3] ? Number(m[3]) : null,
  };
}

/** Builds a partial date string. A day without a month, or anything without a year, is dropped. */
export function buildDate({ y, m, d }: DateParts): string {
  if (!y || y < 1) return '';
  let out = String(y).padStart(4, '0');
  if (m && m >= 1 && m <= 12) {
    out += '-' + String(m).padStart(2, '0');
    if (d && d >= 1 && d <= 31) out += '-' + String(d).padStart(2, '0');
  }
  return out;
}

export function formatDate(s: string): string {
  const { y, m, d } = parseDate(s);
  if (!y) return '';
  if (!m) return String(y);
  if (!d) return `${MONTHS[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function yearOf(s: string): number | null {
  return parseDate(s).y;
}

/** Short lifespan for cards: "1950 – 2020", "b. 1990", "d. 2020". */
export function lifespan(p: Person): string {
  const b = yearOf(p.birthDate);
  const d = yearOf(p.deathDate);
  if (b && d) return `${b} – ${d}`;
  if (b) return p.deceased ? `${b} – ?` : `b. ${b}`;
  if (d) return `d. ${d}`;
  return p.deceased ? 'Deceased' : '';
}

/** Age today, or age at death. Null when it can't be worked out. */
export function ageOf(p: Person, now = new Date()): number | null {
  const b = parseDate(p.birthDate);
  if (!b.y) return null;
  let end: DateParts;
  if (p.deathDate) end = parseDate(p.deathDate);
  else if (p.deceased) return null;
  else end = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  if (!end.y) return null;
  let age = end.y - b.y;
  // Only correct for "birthday not reached yet" when both sides are precise enough.
  if (b.m && end.m) {
    if (end.m < b.m || (end.m === b.m && b.d && end.d && end.d < b.d)) age -= 1;
  }
  return age >= 0 && age < 150 ? age : null;
}

/** Comparator: oldest first, unknown birth dates last (in their existing order). */
export function compareByBirth(a: Person, b: Person): number {
  const ka = birthSortKey(a);
  const kb = birthSortKey(b);
  return ka === kb ? 0 : ka - kb;
}

/** Sort key for ordering siblings oldest-first; unknown dates sort last. */
export function birthSortKey(p: Person): number {
  const { y, m, d } = parseDate(p.birthDate);
  if (!y) return Number.POSITIVE_INFINITY;
  return y * 10000 + (m ?? 0) * 100 + (d ?? 0);
}
