import type { Person, Tree } from '../types';
import { formatDate, isBefore, parseDate, yearOf } from './dates';
import { displayName, isPlaceholder, shortName } from './tree';

// ---------------------------------------------------------------------------
// Coming up: birthdays and anniversaries
// ---------------------------------------------------------------------------

export interface Upcoming {
  person: Person;
  /** A living person's birthday, or the anniversary of someone's death. */
  kind: 'birthday' | 'remembrance';
  /** 0 = today. */
  daysAway: number;
  /** Day and month, e.g. "12 Mar". */
  when: string;
  /** The age they turn, or how many years ago they died; null if the year isn't known. */
  years: number | null;
}

const DAY = 24 * 60 * 60 * 1000;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The next time (from `today`, inclusive) a month/day comes round. 29 Feb falls on 28 Feb in other years. */
function nextOccurrence(m: number, d: number, today: Date): { daysAway: number; year: number } {
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const day = m === 2 && d === 29 && !leap ? 28 : d;
    const t = Date.UTC(year, m - 1, day);
    if (t >= start) return { daysAway: Math.round((t - start) / DAY), year };
  }
  return { daysAway: 366, year: today.getFullYear() + 1 };
}

/** Birthdays of the living and anniversaries of deaths in the next `days` days, soonest first. */
export function upcomingDates(tree: Tree, today = new Date(), days = 30): Upcoming[] {
  const out: Upcoming[] = [];
  for (const person of Object.values(tree.people)) {
    const living = !person.deceased && !person.deathDate;
    const source = living ? person.birthDate : person.deathDate;
    const { y, m, d } = parseDate(source);
    if (!m || !d) continue;
    const next = nextOccurrence(m, d, today);
    if (next.daysAway > days) continue;
    const years = y ? next.year - y : null;
    if (years !== null && (years < 0 || (living && years > 110))) continue;
    out.push({
      person,
      kind: living ? 'birthday' : 'remembrance',
      daysAway: next.daysAway,
      when: `${d} ${SHORT_MONTHS[m - 1]}`,
      years,
    });
  }
  return out.sort((a, b) => a.daysAway - b.daysAway || displayName(a.person).localeCompare(displayName(b.person)));
}


// ---------------------------------------------------------------------------
// Checks: likely mistakes in the data
// ---------------------------------------------------------------------------

export type Severity = 'problem' | 'warning' | 'tip';

export interface Issue {
  /** Stable across visits, so an issue can be dismissed. */
  key: string;
  severity: Severity;
  message: string;
  /** Who it's about. The first is selected; a second is shown alongside it (compared). */
  personIds: string[];
}

const SEVERITY_ORDER: Record<Severity, number> = { problem: 0, warning: 1, tip: 2 };

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/** Looks for dates and links that can't all be right, and people who may be entered twice. */
export function checkTree(tree: Tree, today = new Date()): Issue[] {
  const issues: Issue[] = [];
  const people = Object.values(tree.people);
  const name = (p: Person) => displayName(p);

  for (const p of people) {
    if (p.birthDate && p.deathDate && isBefore(p.deathDate, p.birthDate)) {
      issues.push({
        key: `death-before-birth:${p.id}`,
        severity: 'problem',
        message: `${name(p)} died (${formatDate(p.deathDate)}) before they were born (${formatDate(p.birthDate)})`,
        personIds: [p.id],
      });
    }

    const born = yearOf(p.birthDate);
    if (born && !p.deceased && !p.deathDate && today.getFullYear() - born > 110) {
      issues.push({
        key: `too-old:${p.id}`,
        severity: 'warning',
        message: `${name(p)} would be ${today.getFullYear() - born} - should they be marked as deceased?`,
        personIds: [p.id],
      });
    }

    for (const parentId of p.parentIds) {
      const parent = tree.people[parentId];
      if (!parent || isPlaceholder(parent)) continue;
      const pair = [p.id, parent.id];
      const parentBorn = yearOf(parent.birthDate);

      if (isBefore(p.birthDate, parent.birthDate)) {
        issues.push({
          key: `parent-younger:${p.id}:${parent.id}`,
          severity: 'problem',
          message: `${name(p)} was born before their parent ${name(parent)}`,
          personIds: pair,
        });
      } else if (born && parentBorn) {
        const age = born - parentBorn;
        if (age < 12) {
          issues.push({
            key: `parent-young:${p.id}:${parent.id}`,
            severity: 'warning',
            message: `${name(parent)} was only about ${age} when ${shortName(p)} was born`,
            personIds: pair,
          });
        } else if (age > (parent.gender === 'female' ? 55 : 80)) {
          issues.push({
            key: `parent-old:${p.id}:${parent.id}`,
            severity: 'warning',
            message: `${name(parent)} was about ${age} when ${shortName(p)} was born`,
            personIds: pair,
          });
        }
      }

      // A father can die before a birth; a mother can't, and nobody by more than a year.
      if (p.birthDate && parent.deathDate) {
        const after =
          parent.gender === 'female'
            ? isBefore(parent.deathDate, p.birthDate)
            : (born ?? 0) - (yearOf(parent.deathDate) ?? Infinity) >= 2;
        if (after) {
          issues.push({
            key: `born-after-death:${p.id}:${parent.id}`,
            severity: 'problem',
            message: `${name(p)} was born (${formatDate(p.birthDate)}) after ${name(parent)} died (${formatDate(parent.deathDate)})`,
            personIds: pair,
          });
        }
      }
    }

    if (isPlaceholder(p)) {
      const children = people.filter((c) => c.parentIds.includes(p.id) && !isPlaceholder(c));
      if (children.length > 0) {
        issues.push({
          key: `placeholder:${p.id}`,
          severity: 'tip',
          message: `${children.map(shortName).join(', ')} ${children.length === 1 ? 'has' : 'have'} a parent with no details yet`,
          personIds: [p.id],
        });
      }
    }
  }

  // Possible duplicates: same first and last name, and birth years that don't rule it out.
  const byName = new Map<string, Person[]>();
  for (const p of people) {
    const first = norm(p.firstName);
    const last = norm(p.birthName || p.lastName);
    if (!first || !last) continue;
    const key = `${first}|${last}`;
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  for (const group of byName.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]];
        const ya = yearOf(a.birthDate);
        const yb = yearOf(b.birthDate);
        if (ya && yb && Math.abs(ya - yb) > 1) continue;
        // Named after a parent is common, not a duplicate.
        if (a.parentIds.includes(b.id) || b.parentIds.includes(a.id)) continue;
        const [x, y] = [a.id, b.id].sort();
        issues.push({
          key: `duplicate:${x}:${y}`,
          severity: 'warning',
          message: `There are two people called ${name(a)}${ya || yb ? ` (born ${ya ?? '?'} and ${yb ?? '?'})` : ''} - the same person entered twice?`,
          personIds: [a.id, b.id],
        });
      }
    }
  }

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// Dismissed checks are a per-browser preference, not part of the tree.
const DISMISSED_KEY = 'kindred.checks.dismissed';

export function loadDismissed(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveDismissed(keys: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...keys]));
  } catch {
    /* they'll just come back next visit */
  }
}
