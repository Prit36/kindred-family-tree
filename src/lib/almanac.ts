import type { Gender, Person, Tree } from '../types';
import { ageOf, birthSortKey, parseDate, yearOf } from './dates';
import { factsOf } from './facts';
import { familyIndex } from './lines';
import { memoRecent } from './lru';
import { childrenOf, isPlaceholder } from './tree';

// ---------------------------------------------------------------------------
// The birthday book: who has a day, for any day of the year
// ---------------------------------------------------------------------------

export interface BookEntry {
  person: Person;
  /** A living person's birthday, or the anniversary of someone's death. */
  kind: 'birthday' | 'remembrance';
  /** The year it happened; null when only the day and month are known. */
  year: number | null;
}

export interface Book {
  /** "MM-DD" → everyone with that day */
  days: Map<string, BookEntry[]>;
  /** Birthdays of the living in each month, January first */
  months: number[];
}

const key = (m: number, d: number) => `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const isLiving = (p: Person) => !p.deceased && !p.deathDate;

/**
 * Records copied from a register often give 1 January (or the first of some other month)
 * to everyone whose birthday wasn't written down. When far more people share such a day
 * than chance allows, it isn't a birthday - and counting it would bury the real ones.
 * Returns those days, as "MM-DD".
 */
export const standInDays: (tree: Tree) => ReadonlySet<string> = memoRecent((tree: Tree) => {
  const firsts = new Map<string, number>();
  let dated = 0;
  for (const id in tree.people) {
    const { m, d } = parseDate(tree.people[id].birthDate);
    if (!m || !d) continue;
    dated += 1;
    if (d === 1) firsts.set(key(m, 1), (firsts.get(key(m, 1)) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [k, count] of firsts) if (count >= 5 && count > (dated / 365) * 5) out.add(k);
  return out;
}, 2);

export const birthdayBook: (tree: Tree) => Book = memoRecent((tree: Tree): Book => {
  const days = new Map<string, BookEntry[]>();
  const months = new Array<number>(12).fill(0);
  const standIns = standInDays(tree);
  for (const id in tree.people) {
    const person = tree.people[id];
    const living = isLiving(person);
    const { y, m, d } = parseDate(living ? person.birthDate : person.deathDate);
    if (!m || !d) continue;
    if (living && standIns.has(key(m, d))) continue;
    if (living && y && new Date().getFullYear() - y > 110) continue;
    const k = key(m, d);
    let list = days.get(k);
    if (!list) days.set(k, (list = []));
    list.push({ person, kind: living ? 'birthday' : 'remembrance', year: y });
    if (living) months[m - 1] += 1;
  }
  return { days, months };
}, 2);

export interface DayEntry extends BookEntry {
  /** The age they turn that day, or how many years ago they died; null if the year isn't known. */
  years: number | null;
  /** A birthday ending in 0, or an 18th or 21st. */
  milestone: boolean;
}

const leap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

/** Everyone whose day falls on `date`, birthdays first, eldest first. 29 Feb is kept on 28 Feb in other years. */
export function onDay(book: Book, date: Date): DayEntry[] {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const found = [...(book.days.get(key(m, d)) ?? [])];
  if (m === 2 && d === 28 && !leap(date.getFullYear())) found.push(...(book.days.get('02-29') ?? []));
  const out: DayEntry[] = [];
  for (const e of found) {
    const years = e.year ? date.getFullYear() - e.year : null;
    if (years !== null && years < 0) continue;
    out.push({
      ...e,
      years,
      milestone: e.kind === 'birthday' && years !== null && years > 0 && (years % 10 === 0 || years === 18 || years === 21),
    });
  }
  return out.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'birthday' ? -1 : 1) ||
      (b.years ?? -1) - (a.years ?? -1) ||
      a.person.firstName.localeCompare(b.person.firstName),
  );
}

/** Midnight today, local time. */
export function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export const addDays = (date: Date, n: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

/** Whole days from `a` to `b`. */
export const daysBetween = (a: Date, b: Date) =>
  Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);

/** The days of a month the next time it comes round: this year's, or next year's once it has passed. */
export function monthDays(month: number, from: Date): Date[] {
  const year = month < from.getMonth() ? from.getFullYear() + 1 : from.getFullYear();
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => new Date(year, month, i + 1));
}

/** When someone's next birthday is, and the age they turn. Null when the day isn't known (or is a stand-in). */
export function nextBirthday(tree: Tree, p: Person, from = today()): { daysAway: number; turns: number | null } | null {
  if (!isLiving(p)) return null;
  const { y, m, d } = parseDate(p.birthDate);
  if (!m || !d) return null;
  if (standInDays(tree).has(key(m, d))) return null;
  for (const year of [from.getFullYear(), from.getFullYear() + 1]) {
    const day = m === 2 && d === 29 && !leap(year) ? 28 : d;
    const date = new Date(year, m - 1, day);
    if (date >= from) return { daysAway: daysBetween(from, date), turns: y ? year - y : null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The family in numbers
// ---------------------------------------------------------------------------

export interface Tally {
  label: string;
  count: number;
  /** Which way the people counted lean, for colouring a name */
  gender?: Gender;
}

export interface Decade {
  /** 1980 for the 1980s */
  start: number;
  male: number;
  female: number;
}

export interface FamilyRecord {
  title: string;
  person: Person;
  detail: string;
}

export interface FamilyNumbers {
  people: number;
  families: number;
  couples: number;
  living: number;
  remembered: number;
  firstYear: number | null;
  lastYear: number | null;
  decades: Decade[];
  /** Given names shared by the most people (stored spelling; show with `shown`) */
  givenNames: Tally[];
  surnames: Tally[];
  surnameCount: number;
  records: FamilyRecord[];
  /** The day of the year most people share, and how many */
  busiestDay: { month: number; day: number; count: number } | null;
  blood: Tally[];
  occupations: Tally[];
  occupationCount: number;
  education: Tally[];
}

function tally(counts: Map<string, number>, limit: number): Tally[] {
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

const bump = (counts: Map<string, number>, label: string) => {
  if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
};

const BLOOD_ORDER = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const familyNumbers: (tree: Tree) => FamilyNumbers = memoRecent((tree: Tree): FamilyNumbers => {
  const people = Object.values(tree.people).filter((p) => !isPlaceholder(p));
  const now = new Date();

  const given = new Map<string, number>();
  const givenMale = new Map<string, number>();
  const surnames = new Map<string, number>();
  const blood = new Map<string, number>();
  const occupations = new Map<string, number>();
  const education = new Map<string, number>();
  const decades = new Map<number, Decade>();

  let living = 0;
  let firstYear: number | null = null;
  let lastYear: number | null = null;
  let eldest: Person | null = null;
  let youngest: Person | null = null;
  let mostChildren: { person: Person; count: number } | null = null;

  for (const p of people) {
    const alive = isLiving(p);
    if (alive) living += 1;

    const first = p.firstName.trim();
    bump(given, first);
    if (p.gender === 'male') bump(givenMale, first);
    bump(surnames, p.lastName.trim());

    const born = yearOf(p.birthDate);
    if (born && born <= now.getFullYear()) {
      firstYear = firstYear === null ? born : Math.min(firstYear, born);
      lastYear = lastYear === null ? born : Math.max(lastYear, born);
      const start = Math.floor(born / 10) * 10;
      let decade = decades.get(start);
      if (!decade) decades.set(start, (decade = { start, male: 0, female: 0 }));
      if (p.gender === 'male') decade.male += 1;
      else if (p.gender === 'female') decade.female += 1;

      if (alive && now.getFullYear() - born <= 110) {
        if (!eldest || birthSortKey(p) < birthSortKey(eldest)) eldest = p;
        if (!youngest || birthSortKey(p) > birthSortKey(youngest)) youngest = p;
      }
    }

    const kids = childrenOf(tree, p.id).length;
    if (kids > 1 && (!mostChildren || kids > mostChildren.count)) mostChildren = { person: p, count: kids };

    const facts = factsOf(p);
    bump(blood, facts.blood);
    bump(occupations, facts.occupation);
    bump(education, facts.education);
  }

  const years = (p: Person) => {
    const age = ageOf(p, now);
    return age === null ? '' : age === 1 ? '1 year old' : `${age} years old`;
  };
  const records: FamilyRecord[] = [];
  if (eldest) records.push({ title: 'Eldest', person: eldest, detail: years(eldest) });
  if (youngest && youngest !== eldest) records.push({ title: 'Youngest', person: youngest, detail: years(youngest) });
  if (mostChildren) records.push({ title: 'Most children', person: mostChildren.person, detail: `${mostChildren.count} children` });

  let busiestDay: FamilyNumbers['busiestDay'] = null;
  for (const [k, list] of birthdayBook(tree).days) {
    const count = list.filter((e) => e.kind === 'birthday').length;
    if (count > 1 && (!busiestDay || count > busiestDay.count)) {
      busiestDay = { month: Number(k.slice(0, 2)), day: Number(k.slice(3)), count };
    }
  }

  return {
    people: people.length,
    families: familyIndex(tree).length,
    couples: tree.unions.length,
    living,
    remembered: people.length - living,
    firstYear,
    lastYear,
    decades: [...decades.values()].sort((a, b) => a.start - b.start),
    givenNames: tally(given, 18)
      .filter((t) => t.count > 1)
      .map((t): Tally => ({ ...t, gender: (givenMale.get(t.label) ?? 0) * 2 >= t.count ? 'male' : 'female' })),
    surnames: tally(surnames, 7),
    surnameCount: surnames.size,
    records,
    busiestDay,
    blood: BLOOD_ORDER.filter((g) => blood.has(g)).map((g) => ({ label: g, count: blood.get(g)! })),
    occupations: tally(occupations, 7),
    occupationCount: occupations.size,
    education: tally(education, 7),
  };
}, 2);

