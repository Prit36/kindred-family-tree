import type { Tree } from '../types';
import type { Focus } from './branches';
import { kinshipFor } from './kinship';
import { bloodRelatives, partnersOf, pathBetween, shortName } from './tree';

/**
 * Splits a tree into the "sides" of the family as seen from the home person, so a big
 * tree can be told apart at a glance (each side has a colour) and narrowed down to one
 * side at a time.
 *
 * - **Close family**: you, your parents and everyone descended from them (siblings,
 *   half-siblings, nieces, nephews, your children and grandchildren), and their partners.
 * - **Father's side / Mother's side**: the rest of each parent's blood family -
 *   grandparents, aunts, uncles, cousins - and their partners.
 * - **"Maya's family"**: the blood relatives of someone who married in - your wife's
 *   parents and siblings, your brother's wife's family, your cousin's husband's family.
 * - **Not connected**: anyone with no link to you at all.
 *
 * Every person belongs to exactly one side. Someone who married in belongs to the side
 * of the person they married; their parents and siblings make up their family. A family
 * that married into one of your parents' sides is part of that side for colouring (`tone`), but is still listed - and
 * can be shown - on its own.
 */

export interface FamilySide {
  key: string;
  /** "Father's side", "Maya's family" */
  title: string;
  /** "Robert", "Wife", "Daniel's ex-wife" - or '' when the title says it all */
  subtitle: string;
  /** Whether the subtitle is how `rootId` is related to you (so it can be named in Gujarati too) */
  subtitleIsRelation?: boolean;
  /** People coloured as this side */
  members: string[];
  /** Index into the side colours (see `--side-N` in the stylesheet), or -1 for grey */
  tone: number;
  /** The side this family married into (nested in the list under it), or null */
  parentKey: string | null;
  /** Nesting level in the list: 0 for close family, parents' sides and families married into close family */
  depth: number;
  /** Whose side or family it is: your parent, or the person who married in */
  rootId: string | null;
  /** What showing this side on its own means, or null when it can't be shown alone */
  focus: Focus | null;
}

export interface FamilySides {
  sides: FamilySide[];
  /** Person id → side key */
  sideOf: Map<string, string>;
  byKey: Map<string, FamilySide>;
}

/** How many distinct side colours the stylesheet defines (`--side-0` … ). Close family is 0. */
export const SIDE_TONES = 8;

const EMPTY: FamilySides = { sides: [], sideOf: new Map(), byKey: new Map() };
const cache = new WeakMap<Tree, FamilySides>();

const possessive = (label: string) => `${label}'s`;

export function familySides(tree: Tree): FamilySides {
  const hit = cache.get(tree);
  if (hit) return hit;
  const result = computeSides(tree);
  cache.set(tree, result);
  return result;
}

function computeSides(tree: Tree): FamilySides {
  const homeId = tree.homeId;
  const home = homeId ? tree.people[homeId] : undefined;
  if (!homeId || !home) return EMPTY;

  const kin = kinshipFor(tree);
  const sideOf = new Map<string, string>();
  const sides: FamilySide[] = [];
  let nextTone = 1;

  const addSide = (side: Omit<FamilySide, 'members'>, members: Iterable<string>) => {
    const s: FamilySide = { ...side, members: [] };
    for (const id of members) {
      if (sideOf.has(id)) continue;
      sideOf.set(id, s.key);
      s.members.push(id);
    }
    if (s.members.length === 0) return null;
    sides.push(s);
    return s;
  };

  // --- Close family -----------------------------------------------------------------
  const closeIds = new Set<string>([homeId]);
  const stack = [homeId, ...home.parentIds.filter((p) => tree.people[p])];
  for (const id of stack) closeIds.add(id);
  const children = new Map<string, string[]>();
  for (const p of Object.values(tree.people)) {
    for (const pid of p.parentIds) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid)!.push(p.id);
    }
  }
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of children.get(cur) ?? []) {
      if (closeIds.has(c)) continue;
      closeIds.add(c);
      stack.push(c);
    }
  }
  addSide(
    {
      key: 'close',
      title: 'Close family',
      subtitle: '',
      tone: 0,
      parentKey: null,
      depth: 0,
      rootId: homeId,
      focus: { id: homeId, scope: 'close' },
    },
    closeIds,
  );

  // --- Each parent's side -----------------------------------------------------------
  // Father first, then mother, whatever order they were entered in.
  const genderRank = { male: 0, female: 1, other: 2 } as const;
  const parents = home.parentIds
    .map((id) => tree.people[id])
    .filter(Boolean)
    .sort((a, b) => genderRank[a.gender] - genderRank[b.gender]);
  for (const parent of parents) {
    const label = kin.get(parent.id) || 'Parent';
    const added = addSide(
      {
        key: `side:${parent.id}`,
        title: `${possessive(label)} side`,
        subtitle: shortName(parent),
        tone: nextTone,
        parentKey: null,
        depth: 0,
        rootId: parent.id,
        focus: { id: parent.id, scope: 'side' },
      },
      bloodRelatives(tree, parent.id),
    );
    if (added) nextTone++;
  }

  // --- Families that married in --------------------------------------------------------
  // Everyone placed so far is visited in turn (close family first, so their in-laws come
  // before a cousin's in-laws). A partner joins the side of the person they're with - or of
  // the children they share, for a second partner - and their own blood relatives who
  // aren't placed yet become a family of their own.
  const queue: string[] = sides.flatMap((side) => side.members);
  const sideByKey = new Map(sides.map((side) => [side.key, side]));
  const place = (id: string, side: FamilySide) => {
    sideOf.set(id, side.key);
    side.members.push(id);
    queue.push(id);
  };
  const newSide = (side: Omit<FamilySide, 'members'>, members: string[]) => {
    const s = addSide(side, members);
    if (!s) return;
    if (s.parentKey === null) nextTone++;
    sideByKey.set(s.key, s);
    queue.push(...s.members);
  };
  const visitedPartners = new Set<string>();
  for (let q = 0; q < queue.length; q++) {
    const memberId = queue[q];
    for (const { person: partner } of partnersOf(tree, memberId)) {
      if (!sideOf.has(partner.id)) {
        const shared = (children.get(partner.id) ?? []).find(
          (c) => sideOf.has(c) && tree.people[c].parentIds.includes(memberId),
        );
        place(partner.id, sideByKey.get(sideOf.get(shared ?? memberId)!)!);
      }
      // Membership only grows: a partner's blood family needs visiting once, even
      // when remarriage or shared ancestors reach that partner from several people.
      if (visitedPartners.has(partner.id)) continue;
      visitedPartners.add(partner.id);
      const relatives = [...bloodRelatives(tree, partner.id)].filter((id) => !sideOf.has(id));
      if (relatives.length === 0) continue;
      const host = sideByKey.get(sideOf.get(partner.id)!)!;
      const nested = host.key !== 'close';
      const relation = partner.id === homeId ? 'You' : kin.get(partner.id);
      newSide(
        {
          key: `family:${partner.id}`,
          title: `${possessive(shortName(partner))} family`,
          subtitle: relation || `${possessive(shortName(tree.people[memberId]))} partner`,
          subtitleIsRelation: Boolean(relation),
          // A family married into close family is a side of its own; one that married
          // into a parent's side (or another family) shares that side's colour.
          tone: nested ? host.tone : nextTone,
          parentKey: nested ? host.key : null,
          depth: nested ? host.depth + 1 : 0,
          rootId: partner.id,
          focus: { id: partner.id, scope: 'side' },
        },
        relatives,
      );
    }
  }

  // --- Everyone else -------------------------------------------------------------------
  // Partners and relatives were placed above; what's left has no link to the home person.
  const rest = Object.keys(tree.people).filter((id) => !sideOf.has(id));
  if (rest.length) {
    addSide(
      {
        key: 'unconnected',
        title: 'Not connected to you',
        subtitle: 'No link to you in this tree',
        tone: -1,
        parentKey: null,
        depth: 0,
        rootId: null,
        focus: null,
      },
      rest,
    );
  }

  // Colours run out eventually; wrap round, skipping close family's.
  for (const side of sides) if (side.tone >= SIDE_TONES) side.tone = 1 + ((side.tone - 1) % (SIDE_TONES - 1));

  // List nested families under the side they married into.
  const ordered: FamilySide[] = [];
  const childrenOf = new Map<string | null, FamilySide[]>();
  for (const side of sides) {
    if (!childrenOf.has(side.parentKey)) childrenOf.set(side.parentKey, []);
    childrenOf.get(side.parentKey)!.push(side);
  }
  const visit = (parentKey: string | null) => {
    for (const side of childrenOf.get(parentKey) ?? []) {
      ordered.push(side);
      visit(side.key);
    }
  };
  visit(null);

  return { sides: ordered, sideOf, byKey: new Map(ordered.map((s) => [s.key, s])) };
}

/**
 * What showing one side on its own puts on screen: the side's own people, and the chain
 * linking its root to you (your father for his side, your wife for her family) so it's
 * clear where it joins on. Families that married into the side aren't included.
 */
export function sideMembers(tree: Tree, rootId: string): Set<string> {
  const sides = familySides(tree);
  const side = sides.sides.find((s) => s.rootId === rootId && s.key !== 'close' && s.key !== 'unconnected');
  if (!side) return new Set(tree.people[rootId] ? [rootId] : []);
  const out = new Set(side.members);
  for (const id of (tree.homeId && pathBetween(tree, tree.homeId, rootId)) || [rootId]) out.add(id);
  return out;
}

/** The side a focus shows, if it is one of the listed sides. */
export function sideForFocus(sides: FamilySides, focus: Focus | null): FamilySide | undefined {
  if (!focus) return undefined;
  return sides.sides.find((s) => s.focus && s.focus.id === focus.id && s.focus.scope === focus.scope);
}

/**
 * What a focus shows, as a phrase: "Father's side", "Maya's family", "Arthur's direct line".
 * Sides of the family are named as they're listed; anyone else by their name.
 */
export function focusTitle(tree: Tree, focus: Focus): string {
  const side = sideForFocus(familySides(tree), focus);
  if (side) return side.key === 'close' ? 'your close family' : side.title;
  const name = shortName(tree.people[focus.id]);
  if (focus.scope === 'family') return `${possessive(name)} family`;
  if (focus.scope === 'close') return `${possessive(name)} close family`;
  if (focus.scope === 'side') return `${possessive(name)} side`;
  return `${possessive(name)} direct line`;
}
