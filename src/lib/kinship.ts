import { shapeOf, type Shape } from './shape';
import type { Gender, Tree, Union } from '../types';
import { partnersOf } from './tree';
import { LruMap } from './lru';

/** Describes how everyone in the tree is related to the "home" person. */

interface Up {
  depth: number;
  /** Gender of the first parent on the way up - tells paternal from maternal. */
  side: Gender | null;
}

function ancestorsWithDepth(tree: Tree, id: string): Map<string, Up> {
  const out = new Map<string, Up>([[id, { depth: 0, side: null }]]);
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      const info = out.get(cur)!;
      for (const pid of tree.people[cur]?.parentIds ?? []) {
        const parent = tree.people[pid];
        if (!parent || out.has(pid)) continue;
        out.set(pid, { depth: info.depth + 1, side: info.depth === 0 ? parent.gender : info.side });
        next.push(pid);
      }
    }
    frontier = next;
  }
  return out;
}

interface Blood {
  /** Generations up from the home person to the common ancestor */
  up: number;
  /** Generations down from the common ancestor to the other person */
  down: number;
  side: Gender | null;
}

function bloodLink(a: Map<string, Up>, b: Map<string, Up>): Blood | null {
  let best: Blood | null = null;
  for (const [id, ua] of a) {
    const ub = b.get(id);
    if (!ub) continue;
    if (!best || ua.depth + ub.depth < best.up + best.down) {
      best = { up: ua.depth, down: ub.depth, side: ua.side };
    }
  }
  return best;
}

const pick = (g: Gender, male: string, female: string, neutral: string) =>
  g === 'male' ? male : g === 'female' ? female : neutral;

function greats(n: number): string {
  if (n <= 0) return '';
  if (n <= 2) return 'Great-'.repeat(n);
  return `${n}× great-`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

function describeBlood(link: Blood, g: Gender, half: boolean): string {
  const { up, down, side } = link;
  if (up === 0 && down === 0) return 'You';

  if (down === 0) {
    if (up === 1) return pick(g, 'Father', 'Mother', 'Parent');
    const base = pick(g, 'grandfather', 'grandmother', 'grandparent');
    if (up === 2) {
      const prefix = side === 'male' ? 'Paternal ' : side === 'female' ? 'Maternal ' : '';
      return prefix ? prefix + base : cap(base);
    }
    return cap(greats(up - 2) + base);
  }

  if (up === 0) {
    if (down === 1) return pick(g, 'Son', 'Daughter', 'Child');
    return cap(greats(down - 2) + pick(g, 'grandson', 'granddaughter', 'grandchild'));
  }

  if (up === 1 && down === 1) {
    const base = pick(g, 'brother', 'sister', 'sibling');
    return half ? `Half-${base}` : cap(base);
  }

  if (up === 1) {
    const base = pick(g, 'nephew', 'niece', "sibling's child");
    if (down === 2) return cap(base);
    if (down === 3) return cap('grand' + pick(g, 'nephew', 'niece', 'niece/nephew'));
    return cap(greats(down - 3) + 'grand' + pick(g, 'nephew', 'niece', 'niece/nephew'));
  }

  if (down === 1) {
    const base = pick(g, 'uncle', 'aunt', "parent's sibling");
    if (up === 2) return cap(base);
    return cap(greats(up - 2) + pick(g, 'uncle', 'aunt', 'aunt/uncle'));
  }

  const degree = Math.min(up, down) - 1;
  const removed = Math.abs(up - down);
  const removedText = removed === 0 ? '' : removed === 1 ? ' once removed' : removed === 2 ? ' twice removed' : ` ${removed}× removed`;
  if (degree === 1) return 'Cousin' + removedText;
  return `${ordinal(degree)} cousin${removedText}`;
}

function spouseWord(g: Gender, u: Union): string {
  if (u.status === 'partner') return 'Partner';
  const base = pick(g, 'Husband', 'Wife', 'Spouse');
  return u.status === 'divorced' ? `Ex-${base.toLowerCase()}` : base;
}

const cache = new WeakMap<Shape, Map<string, string>>();

/** Relationship labels relative to the tree's home person (memoised per tree). */
export function kinshipFor(tree: Tree): Map<string, string> {
  let m = cache.get(shapeOf(tree));
  if (!m) cache.set(shapeOf(tree), (m = kinshipMap(tree, tree.homeId)));
  return m;
}

const betweenCache = new WeakMap<Shape, Map<string, Map<string, string>>>();

/** How `otherId` is related to `fromId` ("Great-grandfather", "Wife's brother"…), or '' if they aren't. */
export function relationBetween(tree: Tree, fromId: string, otherId: string): string {
  if (fromId === tree.homeId) return kinshipFor(tree).get(otherId) ?? '';
  let perTree = betweenCache.get(shapeOf(tree));
  if (!perTree) betweenCache.set(shapeOf(tree), (perTree = new LruMap(8)));
  let m = perTree.get(fromId);
  if (!m) perTree.set(fromId, (m = kinshipMap(tree, fromId)));
  return m.get(otherId) ?? '';
}

export function kinshipMap(tree: Tree, homeId: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!homeId || !tree.people[homeId]) return out;

  const home = tree.people[homeId];
  const homeUp = ancestorsWithDepth(tree, homeId);
  const upCache = new Map<string, Map<string, Up>>();
  const upOf = (id: string) => {
    let m = upCache.get(id);
    if (!m) upCache.set(id, (m = ancestorsWithDepth(tree, id)));
    return m;
  };

  const isHalf = (aId: string, bId: string) => {
    const a = tree.people[aId].parentIds;
    const b = tree.people[bId].parentIds;
    if (a.length < 2 || b.length < 2) return false;
    return a.filter((x) => b.includes(x)).length === 1;
  };

  const blood = new Map<string, Blood>();
  for (const p of Object.values(tree.people)) {
    const link = bloodLink(homeUp, upOf(p.id));
    if (link) {
      blood.set(p.id, link);
      out.set(p.id, describeBlood(link, p.gender, link.up === 1 && link.down === 1 && isHalf(homeId, p.id)));
    }
  }

  // My partners
  const homePartners = partnersOf(tree, homeId);
  for (const { person, union } of homePartners) {
    if (!out.has(person.id)) out.set(person.id, spouseWord(person.gender, union));
  }

  // Partners of my blood relatives (step-parents, in-laws, aunts & uncles by marriage)
  for (const [relId, link] of blood) {
    if (relId === homeId) continue;
    const rel = tree.people[relId];
    for (const { person, union } of partnersOf(tree, relId)) {
      if (out.has(person.id)) continue;
      const g = person.gender;
      const ex = union.status === 'divorced';
      let label = '';
      if (!ex) {
        if (link.up === 1 && link.down === 0) label = pick(g, 'Stepfather', 'Stepmother', 'Step-parent');
        else if (link.up === 0 && link.down === 1) label = pick(g, 'Son-in-law', 'Daughter-in-law', 'Child-in-law');
        else if (link.up === 1 && link.down === 1) label = pick(g, 'Brother-in-law', 'Sister-in-law', 'Sibling-in-law');
        else if (link.up === 2 && link.down === 1) label = pick(g, 'Uncle', 'Aunt', 'Aunt/uncle');
        else if (link.up === 2 && link.down === 0) label = pick(g, 'Step-grandfather', 'Step-grandmother', 'Step-grandparent');
      }
      if (!label) {
        const relLabel = describeBlood(link, rel.gender, false);
        label = `${relLabel}'s ${spouseWord(g, union).toLowerCase()}`;
      }
      out.set(person.id, label);
    }
  }

  // Blood relatives of my partners (in-laws, step-children)
  for (const { person: spouse, union } of [...homePartners].sort(
    (a, b) => Number(a.union.status === 'divorced') - Number(b.union.status === 'divorced'),
  )) {
    const spouseUp = upOf(spouse.id);
    const ex = union.status === 'divorced';
    const spouseLabel = spouseWord(spouse.gender, union);
    const siblingsOfSpouse: string[] = [];
    for (const p of Object.values(tree.people)) {
      if (p.id === spouse.id) continue;
      const link = bloodLink(spouseUp, upOf(p.id));
      if (!link) continue;
      if (link.up === 1 && link.down === 1) siblingsOfSpouse.push(p.id);
      if (out.has(p.id)) continue;
      const g = p.gender;
      let label = '';
      if (!ex) {
        if (link.up === 1 && link.down === 0) label = pick(g, 'Father-in-law', 'Mother-in-law', 'Parent-in-law');
        else if (link.up === 1 && link.down === 1) label = pick(g, 'Brother-in-law', 'Sister-in-law', 'Sibling-in-law');
        else if (link.up === 0 && link.down === 1) label = pick(g, 'Stepson', 'Stepdaughter', 'Stepchild');
      }
      if (!label) label = `${spouseLabel}'s ${describeBlood(link, g, false).toLowerCase()}`;
      out.set(p.id, label);
    }
    // Partner's sibling's partner
    if (!ex) {
      for (const sibId of siblingsOfSpouse) {
        for (const { person, union: u } of partnersOf(tree, sibId)) {
          if (out.has(person.id) || u.status === 'divorced') continue;
          out.set(person.id, pick(person.gender, 'Brother-in-law', 'Sister-in-law', 'Sibling-in-law'));
        }
      }
    }
  }

  // Keep the home label friendly even if gender data is odd.
  out.set(home.id, 'You');
  return out;
}
