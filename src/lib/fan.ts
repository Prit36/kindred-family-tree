import { arc } from 'd3-shape';
import type { Gender, Person, Tree } from '../types';
import { compareByBirth } from './dates';
import type { Naming } from './naming';
import { givenName, indexOf, isPlaceholder, partnersOf, shortName } from './tree';

/**
 * The descendants view: one person at the foot of a tree, everyone descended from them
 * spread out above as a canopy. Each generation is a ring and each person a slice of it,
 * as wide as the room their own family needs, so a big branch looks big. The slices hang
 * from bark-coloured branches that thicken towards the trunk, and the person the tree is
 * of sits where the trunk meets the canopy.
 *
 * Angles follow d3-shape: 0 points straight up and they run clockwise. The canopy spans
 * SPAN radians either side of straight up; the gap left at the bottom holds the trunk.
 */

/** Half the canopy's opening: 110° each side of straight up. */
const HALF_SPAN = (110 * Math.PI) / 180;
/** Radius of the disc the root person sits in. */
export const ROOT_R = 80;
/** From the root disc to the first ring: room for the main boughs. */
const BOUGH = 34;
/** Between rings: room for the twigs joining parents to children. */
const GAP = 16;
/** Depth of each ring (the first is a little deeper: fewer, wider slices with two lines of text). */
const RING = (depth: number) => (depth === 1 ? 124 : 112);
/** Smallest label drawn at all (world px); smaller ones never become readable enough to matter. */
const MIN_FONT = 2.5;

export interface FanLabel {
  x: number;
  y: number;
  /** Degrees */
  rotate: number;
  size: number;
  text: string;
  /** Offset of the name from the label's middle, across the line */
  nameY: number;
  /** Their husband or wife ("& Kokilaben"), when there's room, or '' */
  spouse: string;
  spouseSize: number;
  spouseY: number;
  /** The spouse follows the name on the same line rather than under it */
  spouseInline: boolean;
  /** A smaller line (their relationship to you), when there's room */
  sub: string;
  subSize: number;
  subY: number;
}

export interface FanNode {
  id: string;
  person: Person;
  depth: number;
  /** Index of the parent node, -1 for the root */
  parent: number;
  kids: number[];
  a0: number;
  a1: number;
  r0: number;
  r1: number;
  /** Which of the root's children this person descends from (or is) - picks the colour. -1 for the root. */
  branch: number;
  /** Descended through a daughter of the family (so likely born to another surname) */
  viaDaughter: boolean;
  /** Everyone descended from them, as far as the tree knows */
  descendants: number;
  /** Children left out because only the sons' line is shown */
  hidden: number;
  /** Their husbands or wives, if spouses are shown and their names are known */
  spouses: Person[];
  /** Slice outline */
  d: string;
  /** Branch from the parent's slice to this one */
  twig: string;
  /** How thick that branch is drawn */
  twigWidth: number;
  label: FanLabel | null;
}

export interface FanRing {
  depth: number;
  count: number;
  r0: number;
  r1: number;
}

export interface FanLayout {
  nodes: FanNode[];
  index: Map<string, number>;
  rings: FanRing[];
  /** Outer edge of the canopy */
  radius: number;
  /** Where the trunk meets the ground */
  groundY: number;
  living: number;
  bounds: { minX: number; minY: number; width: number; height: number };
}

export interface FanOptions {
  /** Follow only sons: daughters are shown, their children are not. */
  sonsOnly: boolean;
  /** Name each person's husband or wife alongside them. */
  spouses: boolean;
}

const pt = (r: number, a: number): [number, number] => [r * Math.sin(a), -r * Math.cos(a)];
const fmt = (n: number) => Math.round(n * 10) / 10;
const P = (r: number, a: number) => pt(r, a).map(fmt).join(' ');

const sliceArc = arc<{ r0: number; r1: number; a0: number; a1: number; pad: number }>()
  .innerRadius((s) => s.r0)
  .outerRadius((s) => s.r1)
  .startAngle((s) => s.a0)
  .endAngle((s) => s.a1)
  .padAngle((s) => s.pad)
  .padRadius((s) => (s.r0 + s.r1) / 2)
  .cornerRadius((s) => Math.min(6, (s.r1 - s.r0) / 4, ((s.a1 - s.a0) * (s.r0 + s.r1)) / 8));

/** Nobody knows their name: a placeholder, or someone known only through notes. */
export const isNameless = (p: Person) => isPlaceholder(p) || !(p.firstName.trim() || p.lastName.trim() || p.birthName.trim());

/** The name a slice can show: the first given name ("Ramjibhai" from "Ramjibhai Mavjibhai"). */
export function sliceName(p: Person): string {
  if (isNameless(p)) return '';
  // The same in Gujarati script: its words line up with the English ones (રામજીભાઈ માવજીભાઈ).
  return givenName(p).split(/\s+/)[0] || shortName(p);
}

const GUJARATI = /[઀-૿]/;
/** Rough rendered width of text in Inter at font size 1 (Gujarati syllables run wider). */
function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += GUJARATI.test(ch) ? 0.78 : ch === ' ' ? 0.28 : /[A-Z]/.test(ch) ? 0.66 : 0.55;
  return w;
}

/** Line height, in font sizes. */
const LH = 1.18;
/** The spouse's name beside the person's own, and the smallest it may come down to so it fits. */
const SPOUSE = 0.82;
const SPOUSE_MIN = 0.66;
/** The relationship line under the names. */
const SUB = 0.72;

/** Who someone is married to, in the order they married, if their names are known. */
export function spousesOf(tree: Tree, id: string): Person[] {
  return partnersOf(tree, id)
    .filter((x) => x.union.status !== 'divorced' && !isNameless(x.person))
    .map((x) => x.person);
}

/** "& Kokilaben", or "& Kashiben, Maniben" - and, should that not fit, the first and how many more. */
function spouseTexts(spouses: Person[]): string[] {
  const names = spouses.map(sliceName).filter(Boolean);
  if (!names.length) return [];
  const all = `& ${names.join(', ')}`;
  return names.length === 1 ? [all] : [all, `& ${names[0]} +${names.length - 1}`];
}

/**
 * Fits a name into a slice, along the ring or across it - whichever lets it be bigger -
 * then, where there's room, their husband or wife and their relationship to you.
 */
function fitLabel(n: FanNode, text: string, sub: string): FanLabel | null {
  if (!text) return null;
  const thick = n.r1 - n.r0;
  const rm = (n.r0 + n.r1) / 2;
  const am = (n.a0 + n.a1) / 2;
  const arcLen = rm * (n.a1 - n.a0);
  const maxFont = n.depth === 1 ? 17 : n.depth === 2 ? 14.5 : 13;
  const w = textWidth(text);

  // Along the ring: as long as the arc, as tall as the ring is deep.
  const alongW = arcLen - 12;
  const alongFont = Math.min(maxFont, (thick - 16) * 0.5, alongW / w);
  // Across the ring, reading outward: as long as the ring is deep, as tall as the arc.
  const acrossW = thick - 18;
  const acrossFont = Math.min(maxFont, (arcLen - 3) * 0.78, acrossW / w);

  const along = alongFont >= acrossFont * 0.85;
  const size = along ? alongFont : acrossFont;
  if (size < MIN_FONT) return null;

  const deg = (am * 180) / Math.PI;
  let rotate = along ? deg : deg - 90;
  if (rotate > 90) rotate -= 180;
  if (rotate < -90) rotate += 180;
  const [x, y] = pt(rm, am);

  // The spouse: under the name, or - across a narrow slice - after it on the same line.
  let spouse = '';
  let spouseSize = 0;
  let spouseInline = false;
  for (const s of spouseTexts(n.spouses)) {
    const sw = textWidth(s);
    if (along) {
      const fs = Math.min(size * SPOUSE, alongW / sw);
      if (fs >= size * SPOUSE_MIN && fs >= MIN_FONT && (size + fs) * LH <= thick - 16) {
        [spouse, spouseSize] = [s, fs];
        break;
      }
      continue;
    }
    // Under the name: the slice must be wide enough for both lines even at its narrow, inner end.
    const under = Math.min(size * SPOUSE, acrossW / sw);
    const len = Math.max(w * size, sw * under);
    if (under >= size * SPOUSE_MIN && (size + under) * LH <= (rm - len / 2) * (n.a1 - n.a0) - 3) {
      [spouse, spouseSize] = [s, under];
      break;
    }
    const after = Math.min(size * SPOUSE, (acrossW - w * size) / textWidth(` ${s}`));
    if (after >= size * SPOUSE_MIN && after >= MIN_FONT) {
      [spouse, spouseSize, spouseInline] = [s, after, true];
      break;
    }
  }

  // Their relationship to you, only along the ring, where there's depth enough for it too.
  const stacked = spouse && !spouseInline ? spouseSize : 0;
  const subSize = size * SUB;
  const fitsSub =
    along && sub && subSize >= 9 && textWidth(sub) * subSize <= alongW && (size + stacked + subSize) * LH <= thick - 16;

  // The lines, centred together on the middle of the slice.
  const lines = [size, stacked, fitsSub ? subSize : 0];
  let top = (-lines.reduce((s, l) => s + l, 0) * LH) / 2;
  const [nameY, spouseY, subY] = lines.map((l) => {
    const mid = top + (l * LH) / 2;
    top += l * LH;
    return fmt(mid);
  });
  return {
    x: fmt(x),
    y: fmt(y),
    rotate: fmt(rotate),
    size: fmt(size),
    text,
    nameY,
    spouse,
    spouseSize: fmt(spouseSize),
    spouseY,
    spouseInline,
    sub: fitsSub ? sub : '',
    subSize: fmt(subSize),
    subY,
  };
}

/**
 * Someone the tree knows nothing about except their children, called after the eldest
 * named one ("Muljibhai's father") rather than "Unknown".
 */
export function standInName(tree: Tree, p: Person, naming: Naming): string {
  if (!isNameless(p)) return '';
  const kid = (indexOf(tree).children.get(p.id) ?? [])
    .map((k) => tree.people[k])
    .filter(Boolean)
    .sort(compareByBirth)
    .find((k) => sliceName(k));
  if (!kid) return '';
  const name = sliceName(kid);
  const g = p.gender;
  if (naming === 'gu') return `${name}ના ${g === 'female' ? 'માતા' : g === 'male' ? 'પિતા' : 'વડીલ'}`;
  if (naming === 'gu-latn') return `${name} na ${g === 'female' ? 'mata' : g === 'male' ? 'pita' : 'vadil'}`;
  return `${name}'s ${g === 'female' ? 'mother' : g === 'male' ? 'father' : 'parent'}`;
}

/** What to call someone here: their short name (સ્વ. if they have died), or after their child. */
export function treeName(tree: Tree, p: Person, naming: Naming): string {
  return standInName(tree, p, naming) || latePrefix(p, naming) + shortName(p);
}

/**
 * Lays out everyone descended from `rootId`. `subOf` gives the small second line for a
 * slice (their relationship to you), or ''.
 */
export function fanLayout(tree: Tree, rootId: string, opts: FanOptions, subOf: (id: string) => string, naming: Naming = 'en'): FanLayout {
  const { children } = indexOf(tree);
  const nodes: FanNode[] = [];
  const index = new Map<string, number>();
  const seen = new Set<string>();

  // Walk down from the root. Someone descended twice (cousins who married) is drawn under
  // whichever parent is met first.
  const visit = (id: string, depth: number, parent: number, branch: number, viaDaughter: boolean): number => {
    const person = tree.people[id];
    const i = nodes.length;
    seen.add(id);
    index.set(id, i);
    const node: FanNode = {
      id, person, depth, parent, kids: [], a0: 0, a1: 0, r0: 0, r1: 0, branch, viaDaughter,
      descendants: 0, hidden: 0, spouses: opts.spouses ? spousesOf(tree, id) : [], d: '', twig: '', twigWidth: 0, label: null,
    };
    nodes.push(node);
    const kids = (children.get(id) ?? [])
      .filter((k) => tree.people[k] && !seen.has(k))
      .map((k) => tree.people[k])
      .sort(compareByBirth);
    const isDaughter = depth > 0 && person.gender === 'female';
    if (opts.sonsOnly && isDaughter) {
      node.hidden = kids.length;
      return i;
    }
    kids.forEach((k, n) => {
      if (seen.has(k.id)) return;
      const j = visit(k.id, depth + 1, i, depth === 0 ? n : branch, viaDaughter || isDaughter);
      node.kids.push(j);
    });
    return i;
  };
  if (!tree.people[rootId]) {
      return {
      nodes, index, rings: [], radius: ROOT_R, groundY: ROOT_R + 130, living: 0,
      bounds: { minX: -200, minY: -200, width: 400, height: 520 },
    };
  }
  visit(rootId, 0, -1, -1, false);

  // Everyone descended from each person (the whole tree's count, even if some aren't drawn).
  const allDescendants = (id: string, acc: Set<string>) => {
    for (const k of children.get(id) ?? []) {
      if (acc.has(k) || !tree.people[k]) continue;
      acc.add(k);
      allDescendants(k, acc);
    }
    return acc;
  };
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    n.descendants = n.kids.length || n.hidden ? allDescendants(n.id, new Set()).size : 0;
  }

  // Rings.
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const rings: FanRing[] = [];
  let r = ROOT_R + BOUGH;
  for (let d = 1; d <= maxDepth; d++) {
    rings.push({ depth: d, count: 0, r0: r, r1: r + RING(d) });
    r += RING(d) + GAP;
  }
  for (const n of nodes) if (n.depth > 0) rings[n.depth - 1].count++;
  const radius = rings.length ? rings[rings.length - 1].r1 : ROOT_R;

  // Angles: each person gets a share of their parent's arc in proportion to how many
  // people sit at the outer edge of their family (the leaves under them).
  const weight = new Float64Array(nodes.length);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    weight[i] = n.kids.length ? n.kids.reduce((s, k) => s + weight[k], 0) : 1;
  }
  const place = (i: number, a0: number, a1: number) => {
    const n = nodes[i];
    n.a0 = a0;
    n.a1 = a1;
    let a = a0;
    for (const k of n.kids) {
      const span = ((a1 - a0) * weight[k]) / weight[i];
      place(k, a, a + span);
      a += span;
    }
  };
  place(0, -HALF_SPAN, HALF_SPAN);

  const root = nodes[0];
  root.r0 = 0;
  root.r1 = ROOT_R;
  let living = 0;
  for (const n of nodes) {
    if (n.depth > 0 && !n.person.deceased && !n.person.deathDate) living++;
    if (n.depth === 0) continue;
    const ring = rings[n.depth - 1];
    n.r0 = ring.r0;
    n.r1 = ring.r1;
    const rm = (n.r0 + n.r1) / 2;
    n.d = sliceArc({ r0: n.r0, r1: n.r1, a0: n.a0, a1: n.a1, pad: Math.min(2.4 / rm, (n.a1 - n.a0) * 0.3) }) ?? '';

    // The branch it hangs from: thicker the more people it carries.
    const am = (n.a0 + n.a1) / 2;
    const p = nodes[n.parent];
    if (n.depth === 1) {
      // Main boughs fan out of the trunk, behind the root disc.
      n.twigWidth = Math.min(20, 5 + Math.sqrt(weight[index.get(n.id)!]) * 2.4);
      n.twig = `M${P(ROOT_R * 0.35, am)}L${P(n.r0 + 4, am)}`;
    } else {
      const pm = (p.a0 + p.a1) / 2;
      const mid = p.r1 + GAP / 2;
      const large = Math.abs(am - pm) > Math.PI ? 1 : 0;
      const sweep = am > pm ? 1 : 0;
      n.twigWidth = Math.min(10, 1.4 + Math.sqrt(weight[index.get(n.id)!]) * 1.1);
      n.twig = `M${P(p.r1 - 3, pm)}L${P(mid, pm)}A${fmt(mid)} ${fmt(mid)} 0 ${large} ${sweep} ${P(mid, am)}L${P(n.r0 + 3, am)}`;
    }
    n.label = fitLabel(n, sliceName(n.person) || standInName(tree, n.person, naming), n.depth <= 2 ? subOf(n.id) : '');
  }

  // The trunk runs down past the lowest leaves to the ground.
  const lowest = radius * Math.cos(Math.PI - HALF_SPAN);
  const groundY = Math.max(ROOT_R + 130, lowest + 90);
  const minX = -radius - 24;
  const minY = -radius - 24;
  // Room under the ground for the root person's parents.
  const maxY = groundY + 86;
  return {
    nodes,
    index,
    rings,
    radius,
    groundY,
    living,
    bounds: { minX, minY, width: (radius + 60) * 2, height: maxY - minY },
  };
}

/** The box a branch occupies: the person's slice and everything above it. */
export function branchBox(fan: FanLayout, i: number): { minX: number; minY: number; width: number; height: number } {
  const n = fan.nodes[i];
  if (n.depth === 0) return fan.bounds;
  let rOut = n.r1;
  const stack = [i];
  while (stack.length) {
    const j = stack.pop()!;
    rOut = Math.max(rOut, fan.nodes[j].r1);
    stack.push(...fan.nodes[j].kids);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const steps = 12;
  for (let s = 0; s <= steps; s++) {
    const a = n.a0 + ((n.a1 - n.a0) * s) / steps;
    for (const r of [n.r0, rOut]) {
      const [x, y] = pt(r, a);
      xs.push(x);
      ys.push(y);
    }
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Position of a slice's middle, for keeping someone in view. */
export function sliceCentre(n: FanNode): [number, number] {
  if (n.depth === 0) return [0, 0];
  return pt((n.r0 + n.r1) / 2, (n.a0 + n.a1) / 2);
}

/**
 * Where a ring's name goes: level, just under each end of the canopy. The ends step down
 * ring by ring, so even long names never run into the next ring's.
 */
export function ringLabelSpots(ring: FanRing): { x: number; y: number; anchor: 'start' | 'end' }[] {
  const rm = (ring.r0 + ring.r1) / 2;
  const [x, y] = pt(rm, HALF_SPAN);
  return [
    { x: fmt(x - 40), y: fmt(y + 26), anchor: 'start' },
    { x: fmt(-x + 40), y: fmt(y + 26), anchor: 'end' },
  ];
}

// ---------------------------------------------------------------------------
// Generation names
// ---------------------------------------------------------------------------

/**
 * What a generation below someone is called: their children, grandchildren… In Gujarati
 * a son's children (પૌત્ર) have a different word from a daughter's (દોહિત્ર).
 */
export function generationName(depth: number, naming: Naming, withDaughters: boolean): string {
  if (naming === 'en') {
    if (depth === 1) return 'Children';
    if (depth === 2) return 'Grandchildren';
    if (depth === 3) return 'Great-grandchildren';
    return `${depth - 2}× great-grandchildren`;
  }
  const gu = naming === 'gu';
  if (depth === 1) return gu ? 'દીકરા-દીકરી' : 'Dikra-Dikri';
  if (depth === 2) {
    if (gu) return withDaughters ? 'પૌત્ર-પૌત્રી · દોહિત્ર' : 'પૌત્ર-પૌત્રી';
    return withDaughters ? 'Pautra-Pautri · Dohitra' : 'Pautra-Pautri';
  }
  if (depth === 3) return gu ? 'પ્રપૌત્ર-પ્રપૌત્રી' : 'Prapautra-Prapautri';
  return gu ? `${toGujaratiDigits(depth + 1)}મી પેઢી` : `${depth + 1}mi pedhi`;
}

const GU_DIGITS = '૦૧૨૩૪૫૬૭૮૯';
export const toGujaratiDigits = (n: number) => String(n).replace(/\d/g, (d) => GU_DIGITS[Number(d)]);

/** "Late" before the name of someone who has died, as Gujarati does (સ્વ. માવજીભાઈ). */
export function latePrefix(p: Person, naming: Naming): string {
  if (!p.deceased && !p.deathDate) return '';
  return naming === 'gu' ? 'સ્વ. ' : naming === 'gu-latn' ? 'Sva. ' : '';
}

/**
 * The person whose family this most likely is: up the father's line from `id` as far as
 * it goes, then back down past anyone with only one child - the tree of a great-great-
 * grandfather known only as "Mavji's father" is really Mavji's.
 */
export function patriarchOf(tree: Tree, id: string): string {
  const line = [id];
  const seen = new Set<string>([id]);
  for (;;) {
    const cur = line[line.length - 1];
    const parents = tree.people[cur]?.parentIds.map((p) => tree.people[p]).filter(Boolean) ?? [];
    const next = parents.find((p) => p.gender === 'male') ?? parents[0];
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    line.push(next.id);
  }
  const { children } = indexOf(tree);
  // Step down while the family doesn't branch, but never down to `id` itself.
  let i = line.length - 1;
  while (i > 1 && (children.get(line[i])?.length ?? 0) === 1) i--;
  return line[i];
}

/**
 * The heads of the tree's families, biggest first: people with no parents in the tree
 * (and not married to someone who has - they married in), stepping down past anyone known
 * only through a single child, as `patriarchOf` does.
 */
export function largestFamilies(tree: Tree, limit = 6): { id: string; count: number }[] {
  const { children, unions } = indexOf(tree);
  const hasParents = (id: string) => tree.people[id]?.parentIds.some((p) => tree.people[p]) ?? false;
  const partners = (id: string) => (unions.get(id) ?? []).map((u) => (u.a === id ? u.b : u.a));
  const sizeOf = (id: string): number => {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      for (const k of children.get(stack.pop()!) ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        stack.push(k);
      }
    }
    return seen.size;
  };
  const heads = new Map<string, number>();
  const taken = new Set<string>();
  const candidates = Object.values(tree.people)
    .filter((p) => !hasParents(p.id) && children.get(p.id)?.length && !partners(p.id).some(hasParents))
    .sort((a, b) => genderRank(a.gender) - genderRank(b.gender));
  for (const p of candidates) {
    if (taken.has(p.id)) continue;
    taken.add(p.id);
    // A couple shares one family: the first listed (the husband, usually) stands for both.
    for (const q of partners(p.id)) taken.add(q);
    let head = p.id;
    const seen = new Set([head]);
    for (;;) {
      const kids = children.get(head) ?? [];
      if (kids.length !== 1 || seen.has(kids[0]) || !children.get(kids[0])?.length) break;
      head = kids[0];
      seen.add(head);
    }
    if (!heads.has(head)) heads.set(head, sizeOf(head));
  }
  return [...heads]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }));
}

/** How many people are descended from `id`. */
export function descendantCount(tree: Tree, id: string): number {
  const { children } = indexOf(tree);
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    for (const k of children.get(stack.pop()!) ?? []) {
      if (seen.has(k) || !tree.people[k]) continue;
      seen.add(k);
      stack.push(k);
    }
  }
  return seen.size;
}

const genderRank = (g: Gender) => (g === 'male' ? 0 : g === 'female' ? 1 : 2);
