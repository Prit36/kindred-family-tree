import type { Tree } from '../types';
import { birthSortKey } from './dates';
import { LruMap, RecentMap } from './lru';
import { shapeOf, type Shape } from './shape';
import { shortName } from './tree';
import type { Person } from '../types';

/**
 * Family lines: the tree split into the families it's made of, each drawn on its own.
 *
 * Every couple belongs to one family - the one they're drawn under. Where both partners'
 * parents are in the tree, that's the husband's by custom (more exactly: the partner born
 * into their family, not married in, a man first, then the eldest). Followed up from
 * couple to parents, every couple ends at the top of one family line: "the Mojidras",
 * descended from one ancestor, with everyone who married into it.
 *
 * Someone who married into another family is drawn there, with their partner and children,
 * and carries a "from Bhalgamiya" bridge back to the family they came from. In that family
 * they still appear under their parents, as a dashed card "married into Mojidra" - so each
 * family is one clean tree, and every marriage between families is a bridge, not a line
 * across the canvas.
 */
export interface FamilyLines {
  /** Person → the family line they're drawn in. A line's key is the id of the person at its top. */
  lineOf: Map<string, string>;
  /** Person → the family they were born into, for those drawn in another one (married out) */
  bornIn: Map<string, string>;
  /** Line key → the people drawn in it */
  members: Map<string, string[]>;
  /** Line key → those born into it who are drawn in another family (the dashed cards) */
  marriedOut: Map<string, string[]>;
  /** Line key → what the family is called: its surname, "Mojidra" - or '' when nobody's is known */
  names: Map<string, string>;
}

const linesCache = new RecentMap<Shape, FamilyLines>(6);

export function familyLines(tree: Tree): FamilyLines {
  let lines = linesCache.get(shapeOf(tree));
  if (!lines) linesCache.set(shapeOf(tree), (lines = compute(tree)));
  return lines;
}

function compute(tree: Tree): FamilyLines {
  const { people } = tree;
  const ids = Object.keys(people);

  // Partners, grouped (someone married twice is in one group with both partners).
  const root = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let r = id;
    while (root.get(r) !== r) r = root.get(r)!;
    root.set(id, r);
    return r;
  };
  for (const u of tree.unions) {
    if (people[u.a] && people[u.b]) root.set(find(u.a), find(u.b));
  }
  const members = new Map<string, string[]>();
  for (const id of ids) {
    const g = find(id);
    if (!members.has(g)) members.set(g, []);
    members.get(g)!.push(id);
  }

  const parents = (id: string) => people[id].parentIds.filter((p) => people[p]);
  const age = new Map(ids.map((id) => [id, birthSortKey(people[id])]));

  // Which partner each couple is drawn under: the one whose parents they hang from.
  const under = new Map<string, string>();
  for (const [g, list] of members) {
    const candidates = list.filter((m) => parents(m).length > 0);
    if (candidates.length === 0) continue;
    const male = (m: string) => people[m].gender === 'male';
    const born = (m: string) => !people[m].birthName;
    const pick =
      candidates.find((m) => born(m) && male(m)) ??
      candidates.find(born) ??
      candidates.find(male) ??
      candidates.reduce((a, b) => (age.get(a)! <= age.get(b)! ? a : b));
    under.set(g, pick);
  }

  // Up from each couple to the top of their family line (a loop, possible only with odd
  // data, stops where it closes).
  const top = new Map<string, string>();
  const lineRoot = (g: string): string => {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur = g;
    let found: string | undefined;
    for (;;) {
      found = top.get(cur);
      if (found !== undefined) break;
      const pick = under.get(cur);
      if (pick === undefined || onPath.has(cur)) {
        found = cur;
        break;
      }
      path.push(cur);
      onPath.add(cur);
      const next = find(parents(pick)[0]);
      if (onPath.has(next)) {
        found = cur;
        break;
      }
      cur = next;
    }
    for (const p of path) top.set(p, found);
    top.set(cur, found);
    return found;
  };

  // A line is known by the person at its top (the husband of the first couple), which -
  // unlike the grouping above - stays the same as people are added and edited.
  const headOf = (g: string) => {
    const list = members.get(g)!;
    return (
      list.find((m) => people[m].gender === 'male' && !people[m].birthName) ??
      list.find((m) => !people[m].birthName) ??
      list[0]
    );
  };
  const lineOf = new Map<string, string>();
  const lineMembers = new Map<string, string[]>();
  for (const [g, list] of members) {
    const topGroup = lineRoot(g);
    const key = headOf(topGroup);
    if (!lineMembers.has(key)) lineMembers.set(key, []);
    for (const id of list) {
      lineOf.set(id, key);
      lineMembers.get(key)!.push(id);
    }
  }

  const bornIn = new Map<string, string>();
  const marriedOut = new Map<string, string[]>();
  for (const id of ids) {
    const ps = parents(id);
    if (ps.length === 0) continue;
    const home = lineOf.get(ps[0])!;
    if (home === lineOf.get(id)) continue;
    bornIn.set(id, home);
    if (!marriedOut.has(home)) marriedOut.set(home, []);
    marriedOut.get(home)!.push(id);
  }

  // A family is called by the surname most of those born into it share: their surname if
  // they stayed, a maiden name if they married out (a married name is the other family's).
  const names = new Map<string, string>();
  for (const [key, list] of lineMembers) {
    const head = key;
    const counts = new Map<string, number>();
    const vote = (name: string, weight: number) => {
      const n = name.trim();
      if (n) counts.set(n, (counts.get(n) ?? 0) + weight);
    };
    for (const id of list) {
      if (bornIn.has(id) || (parents(id).length === 0 && id !== head)) continue;
      vote(people[id].birthName || people[id].lastName, id === head ? 0.5 : 1);
    }
    for (const id of marriedOut.get(key) ?? []) vote(people[id].birthName, 1);
    let best = '';
    let most = 0;
    for (const [name, n] of counts) if (n > most) [best, most] = [name, n];
    names.set(key, best);
  }

  return { lineOf, bornIn, members: lineMembers, marriedOut, names };
}

const idsCache = new RecentMap<Shape, LruMap<string, ReadonlySet<string>>>(6);

/** Everyone drawn when a family line is shown: its own people and its dashed married-out cards. */
export function lineIds(tree: Tree, key: string): ReadonlySet<string> {
  let perTree = idsCache.get(shapeOf(tree));
  if (!perTree) idsCache.set(shapeOf(tree), (perTree = new LruMap(16)));
  let ids = perTree.get(key);
  if (!ids) {
    const lines = familyLines(tree);
    ids = new Set([...(lines.members.get(key) ?? []), ...(lines.marriedOut.get(key) ?? [])]);
    perTree.set(key, ids);
  }
  return ids;
}

const their = (p: Person) => (p.gender === 'female' ? 'her' : p.gender === 'male' ? 'his' : 'their');

/**
 * What a family is called where it's shown: its surname, else after the person it was
 * reached through ("Laleetaben's family"), else after the person at its top.
 */
export function lineTitle(tree: Tree, key: string, via?: string): string {
  const lines = familyLines(tree);
  const name = lines.names.get(key);
  if (name) return name;
  const who = (via && tree.people[via]) || tree.people[key];
  return who ? `${shortName(who)}'s family` : 'Family';
}

export interface Bridge {
  /** `from`: someone who married in, to the family they were born into; `into`: the reverse */
  kind: 'from' | 'into';
  /** The family line it leads to */
  line: string;
  /** "from Bhalgamiya", "married into Mojidra" */
  label: string;
  tip: string;
}

/** The bridge on someone's card while `shown` is the family on screen, if they have one. */
export function bridgeOf(tree: Tree, shown: string, id: string): Bridge | null {
  const lines = familyLines(tree);
  const p = tree.people[id];
  if (!p) return null;
  const drawnIn = lines.lineOf.get(id)!;
  if (drawnIn !== shown) {
    // A dashed card: born here, drawn with their partner's family.
    const name = lines.names.get(drawnIn);
    const partner = tree.unions
      .map((u) => (u.a === id ? u.b : u.b === id ? u.a : null))
      .find((other) => other && lines.lineOf.get(other) === drawnIn);
    const title = name || lineTitle(tree, drawnIn, partner ?? undefined);
    return { kind: 'into', line: drawnIn, label: `married into ${title}`, tip: `Show the family ${shortName(p)} married into` };
  }
  const from = lines.bornIn.get(id);
  if (!from) return null;
  const name = lines.names.get(from);
  return {
    kind: 'from',
    line: from,
    label: name ? `from ${name}` : `from ${their(p)} family`,
    tip: `Show the family ${shortName(p)} was born into`,
  };
}

/** The family someone is drawn in, as a label: "Mojidra family", or "Laleetaben's family". */
export function familyLabel(tree: Tree, id: string): string {
  const lines = familyLines(tree);
  const key = lines.lineOf.get(id);
  if (!key) return 'Family';
  const name = lines.names.get(key);
  return name ? `${name} family` : lineTitle(tree, key, id);
}
