import type { Person, Tree } from '../types';
import { formatDate, isBefore, yearOf } from './dates';
import { childrenOf, fullName, isPlaceholder, shortName } from './tree';
import { middleNameOf } from './names';

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
  const name = (p: Person) => fullName(tree, p);

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
      const children = childrenOf(tree, p.id).filter((c) => !isPlaceholder(c));
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

  // Possible duplicates: same whole name (father's included), and birth years that don't rule it out.
  const byName = new Map<string, Person[]>();
  for (const p of people) {
    const first = norm(`${p.firstName} ${middleNameOf(tree, p)}`);
    const last = norm(p.birthName || p.lastName);
    if (!first || !last) continue;
    const key = `${first}|${last}`;
    let group = byName.get(key);
    if (!group) byName.set(key, (group = []));
    group.push(p);
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
