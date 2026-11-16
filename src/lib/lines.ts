import type { Tree } from '../types';
import { birthSortKey } from './dates';
import { LruMap, RecentMap } from './lru';
import { shapeOf, type Shape } from './shape';
import { shortName, shown } from './tree';
import type { Person } from '../types';
import type { Naming } from './naming';

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
 * The words the family view is written in, following the naming chosen for relationships:
 * in ગુજરાતી a family is a પરિવાર, the one a woman was born into her પિયર and the one she
 * married into her સાસરું.
 */
export interface FamilyWords {
  /** "Laleetaben's family" */
  familyOf: (name: string) => string;
  /** "Mojidra family" */
  named: (surname: string) => string;
  /** On someone who married in: "from Bhalgamiya" (or, unnamed, "from her family") */
  from: (p: Person, family: string) => string;
  /** On someone who married out: "married into Mojidra" */
  into: (family: string) => string;
  /** Who leads to a linked family: "via Vidhi and Nehal" */
  via: (names: string[]) => string;
  people: (n: number) => string;
  generations: (n: number) => string;
  linkedHeading: string;
  allHeading: string;
  familiesHeading: string;
  foundHeading: string;
  findPlaceholder: string;
  nothingFound: string;
  wholeTree: string;
}

const listOf = (lang: string) => {
  const f = new Intl.ListFormat(lang, { type: 'conjunction' });
  return (names: string[]) => f.format(names);
};
const enList = listOf('en');
const guList = listOf('gu');

const WORDS: Record<Naming, FamilyWords> = {
  en: {
    familyOf: (name) => `${name}'s family`,
    named: (surname) => `${surname} family`,
    from: (p, family) => (family ? `from ${family}` : `from ${their(p)} family`),
    into: (family) => `married into ${family}`,
    via: (names) => `via ${enList(names)}`,
    people: (n) => `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`,
    generations: (n) => `${n} ${n === 1 ? 'generation' : 'generations'}`,
    linkedHeading: 'Linked by marriage',
    allHeading: 'All families',
    familiesHeading: 'Families',
    foundHeading: 'Families of people found',
    findPlaceholder: 'Find a family or someone in it…',
    nothingFound: 'No family or person by that name',
    wholeTree: 'Show the whole tree',
  },
  gu: {
    familyOf: (name) => `${name}નો પરિવાર`,
    named: (surname) => `${surname} પરિવાર`,
    from: (p, family) =>
      p.gender === 'female' ? (family ? `પિયર: ${family}` : 'પિયર') : family ? `મૂળ: ${family}` : 'મૂળ પરિવાર',
    into: (family) => `સાસરું: ${family}`,
    via: (names) => `${guList(names)} દ્વારા`,
    people: (n) => `${n.toLocaleString()} વ્યક્તિ`,
    generations: (n) => `${n} પેઢી`,
    linkedHeading: 'લગ્નથી જોડાયેલા',
    allHeading: 'બધા પરિવાર',
    familiesHeading: 'પરિવાર',
    foundHeading: 'મળેલા લોકોના પરિવાર',
    findPlaceholder: 'પરિવાર કે વ્યક્તિ શોધો…',
    nothingFound: 'એ નામનો કોઈ પરિવાર કે વ્યક્તિ નથી',
    wholeTree: 'આખું વૃક્ષ બતાવો',
  },
  'gu-latn': {
    familyOf: (name) => `${name} no parivar`,
    named: (surname) => `${surname} parivar`,
    from: (p, family) =>
      p.gender === 'female' ? (family ? `Piyar: ${family}` : 'Piyar') : family ? `Mool: ${family}` : 'Mool parivar',
    into: (family) => `Sasru: ${family}`,
    via: (names) => `${enList(names)} dwara`,
    people: (n) => `${n.toLocaleString()} vyakti`,
    generations: (n) => `${n} pedhi`,
    linkedHeading: 'Lagn thi jodayela',
    allHeading: 'Badha parivar',
    familiesHeading: 'Parivar',
    foundHeading: 'Malela loko na parivar',
    findPlaceholder: 'Parivar ke vyakti shodho…',
    nothingFound: 'E naam no koi parivar ke vyakti nathi',
    wholeTree: 'Aakhu vruksh batavo',
  },
};

export const familyWords = (naming: Naming): FamilyWords => WORDS[naming];

/** A family's surname as shown - in Gujarati script when names are - or '' when it has none. */
function surnameOf(tree: Tree, key: string): string {
  const name = familyLines(tree).names.get(key);
  return name ? shown(name) : '';
}

/**
 * What a family is called where it's shown: its surname, else after the person it was
 * reached through ("Laleetaben's family"), else after the person at its top.
 */
export function lineTitle(tree: Tree, key: string, naming: Naming, via?: string): string {
  const name = surnameOf(tree, key);
  if (name) return name;
  const who = (via && tree.people[via]) || tree.people[key];
  return WORDS[naming].familyOf(shortName(who));
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

/** The bridge on someone's card while `onShow` is the family on screen, if they have one. */
export function bridgeOf(tree: Tree, onShow: string, id: string, naming: Naming): Bridge | null {
  const lines = familyLines(tree);
  const words = WORDS[naming];
  const p = tree.people[id];
  if (!p) return null;
  const drawnIn = lines.lineOf.get(id)!;
  if (drawnIn !== onShow) {
    // A dashed card: born here, drawn with their partner's family.
    const partner = tree.unions
      .map((u) => (u.a === id ? u.b : u.b === id ? u.a : null))
      .find((other) => other && lines.lineOf.get(other) === drawnIn);
    const title = lineTitle(tree, drawnIn, naming, partner ?? undefined);
    return { kind: 'into', line: drawnIn, label: words.into(title), tip: `Show the family ${shortName(p)} married into` };
  }
  const from = lines.bornIn.get(id);
  if (!from) return null;
  return {
    kind: 'from',
    line: from,
    label: words.from(p, surnameOf(tree, from)),
    tip: `Show the family ${shortName(p)} was born into`,
  };
}

/** The family someone is drawn in, as a label: "Mojidra family", or "Laleetaben's family". */
export function familyLabel(tree: Tree, id: string, naming: Naming): string {
  const key = familyLines(tree).lineOf.get(id) ?? id;
  const name = surnameOf(tree, key);
  return name ? WORDS[naming].named(name) : lineTitle(tree, key, naming, id);
}

export interface FamilyEntry {
  /** The family line's key: the id of the person at its top */
  key: string;
  /** How many are drawn when it's on show, the dashed cards of those who married out included */
  size: number;
}

const indexCache = new RecentMap<Shape, FamilyEntry[]>(6);

/** Every family in the tree, biggest first. */
export function familyIndex(tree: Tree): FamilyEntry[] {
  let index = indexCache.get(shapeOf(tree));
  if (!index) {
    const lines = familyLines(tree);
    index = [...lines.members]
      .map(([key, list]) => ({ key, size: list.length + (lines.marriedOut.get(key)?.length ?? 0) }))
      .sort((a, b) => b.size - a.size);
    indexCache.set(shapeOf(tree), index);
  }
  return index;
}

/**
 * Who a family descends from, to tell apart families of the same name: "Mavjibhai's family".
 * Empty when the family is already called after them.
 */
export function lineHead(tree: Tree, key: string, naming: Naming): string {
  const head = tree.people[key];
  if (!head || !familyLines(tree).names.get(key)) return '';
  return WORDS[naming].familyOf(shortName(head));
}

/** What a search for a family is matched against: its surname in both scripts. */
export function lineSearchText(tree: Tree, key: string, naming: Naming): string {
  const latin = familyLines(tree).names.get(key) ?? '';
  return `${latin} ${lineTitle(tree, key, naming)}`.toLowerCase();
}
