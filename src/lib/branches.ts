import type { Tree } from '../types';
import { ancestorIds, descendantIds, partnersOf, siblingsOf } from './tree';

/**
 * Which part of a large tree is drawn.
 *
 * Two independent ways to cut a tree down to size:
 *
 * - **Focus** shows one person's branch on its own: their ancestors, their descendants
 *   (with partners) and their immediate family.
 * - **Collapsing** folds a branch away at a connector. `down:<parents>` stops at a couple
 *   instead of continuing to their children; `up:<person>` stops at a person instead of
 *   continuing to their parents. Whoever can no longer be reached from the home person is
 *   hidden - so folding below a couple on your own direct line keeps your line and tucks
 *   away the other children's branches.
 *
 * Collapsing is ignored while a branch is focused; the folds come back afterwards.
 */

export type Collapsed = ReadonlySet<string>;
export const NOTHING_COLLAPSED: Collapsed = new Set<string>();

export interface BranchToggle {
  /** `down:<sorted parent ids joined by |>` or `up:<person id>` */
  key: string;
  kind: 'down' | 'up';
  /** down: the parent(s) the children hang from; up: the person whose parents fold away */
  ids: string[];
  collapsed: boolean;
  /** People it is hiding (collapsed) or would hide (expanded) */
  count: number;
}

// ---------------------------------------------------------------------------
// Graph (memoised per tree object, trees are immutable)
// ---------------------------------------------------------------------------

interface Family {
  key: string;
  parents: number[];
  children: number[];
}

interface Graph {
  ids: string[];
  at: Map<string, number>;
  partners: number[][];
  parents: number[][];
  upKeys: string[];
  /** The families each person is a parent in */
  families: Family[][];
  allFamilies: Family[];
  /** One starting point per unconnected family: the home person, else whoever was added first */
  roots: number[];
}

const graphCache = new WeakMap<Tree, Graph>();

function graphOf(tree: Tree): Graph {
  let g = graphCache.get(tree);
  if (g) return g;

  const ids = Object.keys(tree.people);
  const at = new Map(ids.map((id, i) => [id, i]));
  const partners: number[][] = ids.map(() => []);
  const parents: number[][] = ids.map(() => []);
  const families: Family[][] = ids.map(() => []);
  const allFamilies: Family[] = [];

  for (const u of tree.unions) {
    const a = at.get(u.a);
    const b = at.get(u.b);
    if (a === undefined || b === undefined) continue;
    partners[a].push(b);
    partners[b].push(a);
  }

  const byKey = new Map<string, Family>();
  ids.forEach((id, i) => {
    const parentIds = tree.people[id].parentIds.filter((p) => at.has(p)).sort();
    if (parentIds.length === 0) return;
    parents[i] = parentIds.map((p) => at.get(p)!);
    const key = `down:${parentIds.join('|')}`;
    let fam = byKey.get(key);
    if (!fam) {
      fam = { key, parents: parents[i], children: [] };
      byKey.set(key, fam);
      allFamilies.push(fam);
      for (const p of fam.parents) families[p].push(fam);
    }
    fam.children.push(i);
  });

  g = { ids, at, partners, parents, upKeys: ids.map((id) => `up:${id}`), families, allFamilies, roots: [] };

  const seen = new Uint8Array(ids.length);
  const home = tree.homeId ? at.get(tree.homeId) : undefined;
  const flood = (start: number) => {
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      const visit = (n: number) => {
        if (!seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      };
      partners[cur].forEach(visit);
      parents[cur].forEach(visit);
      for (const fam of families[cur]) fam.children.forEach(visit);
    }
  };
  for (const i of home === undefined ? ids.keys() : [home, ...ids.keys()]) {
    if (seen[i]) continue;
    g.roots.push(i);
    flood(i);
  }

  graphCache.set(tree, g);
  return g;
}

/**
 * Everyone reachable from the roots. A collapsed `down` key blocks the step from parents
 * to children, a collapsed `up` key the step from a person to their parents - only in
 * that direction, so the folded side stays reachable from people on it.
 * `flip` treats one key as toggled, to measure what it hides.
 */
function reach(g: Graph, collapsed: Collapsed, flip?: string): Uint8Array {
  const blocked = (key: string) => collapsed.has(key) !== (key === flip);
  const seen = new Uint8Array(g.ids.length);
  const stack = [...g.roots];
  for (const r of stack) seen[r] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of g.partners[cur]) {
      if (!seen[n]) {
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (g.parents[cur].length && !blocked(g.upKeys[cur])) {
      for (const n of g.parents[cur]) {
        if (!seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    for (const fam of g.families[cur]) {
      if (blocked(fam.key)) continue;
      for (const n of fam.children) {
        if (!seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
  }
  return seen;
}

const countOf = (seen: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < seen.length; i++) n += seen[i];
  return n;
};

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

/**
 * One person's branch: their ancestors, descendants and immediate family. Descendants
 * bring their partners along so each of their families is drawn whole.
 */
export function branchOf(tree: Tree, id: string): Set<string> {
  const out = new Set<string>();
  if (!tree.people[id]) return out;
  out.add(id);
  for (const a of ancestorIds(tree, id)) out.add(a);
  for (const d of descendantIds(tree, id)) {
    out.add(d);
    for (const { person } of partnersOf(tree, d)) out.add(person.id);
  }
  for (const { person } of partnersOf(tree, id)) out.add(person.id);
  for (const s of siblingsOf(tree, id)) out.add(s.id);
  return out;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

const visibleCache = new WeakMap<Tree, { focusId: string | null; collapsed: Collapsed; ids: ReadonlySet<string> }>();

/** The people drawn on the canvas for this focus and these folds. */
export function visibleIds(tree: Tree, focusId: string | null, collapsed: Collapsed): ReadonlySet<string> {
  const hit = visibleCache.get(tree);
  if (hit && hit.focusId === focusId && hit.collapsed === collapsed) return hit.ids;

  let ids: Set<string>;
  if (focusId && tree.people[focusId]) {
    ids = branchOf(tree, focusId);
  } else {
    const g = graphOf(tree);
    const seen = reach(g, collapsed);
    ids = new Set<string>();
    g.ids.forEach((id, i) => {
      if (seen[i]) ids.add(id);
    });
  }
  visibleCache.set(tree, { focusId, collapsed, ids });
  return ids;
}

const toggleCache = new WeakMap<Tree, { collapsed: Collapsed; toggles: BranchToggle[] }>();

/**
 * Every place the tree can be folded or unfolded right now. A fold that wouldn't hide
 * anybody (an only child's parents, say) isn't offered.
 */
export function branchToggles(tree: Tree, collapsed: Collapsed): BranchToggle[] {
  const hit = toggleCache.get(tree);
  if (hit && hit.collapsed === collapsed) return hit.toggles;

  const g = graphOf(tree);
  const base = reach(g, collapsed);
  const shown = countOf(base);
  const effect = (key: string) => Math.abs(shown - countOf(reach(g, collapsed, key)));

  const toggles: BranchToggle[] = [];
  for (const fam of g.allFamilies) {
    if (!base[fam.parents[0]]) continue;
    const count = effect(fam.key);
    if (count > 0) {
      toggles.push({
        key: fam.key,
        kind: 'down',
        ids: fam.parents.map((i) => g.ids[i]),
        collapsed: collapsed.has(fam.key),
        count,
      });
    }
  }
  g.ids.forEach((id, i) => {
    if (!base[i] || g.parents[i].length === 0) return;
    const key = g.upKeys[i];
    const count = effect(key);
    if (count > 0) toggles.push({ key, kind: 'up', ids: [id], collapsed: collapsed.has(key), count });
  });

  toggleCache.set(tree, { collapsed, toggles });
  return toggles;
}

/** The folds that still refer to something in this tree. */
export function pruneCollapsed(tree: Tree, collapsed: Collapsed): Collapsed {
  if (collapsed.size === 0) return collapsed;
  const g = graphOf(tree);
  const valid = new Set<string>(g.allFamilies.map((f) => f.key));
  g.parents.forEach((p, i) => {
    if (p.length) valid.add(g.upKeys[i]);
  });
  const kept = [...collapsed].filter((key) => valid.has(key));
  if (kept.length === collapsed.size) return collapsed;
  return kept.length ? new Set(kept) : NOTHING_COLLAPSED;
}

/**
 * Opens just enough folds to bring one person into view: those along the route to them
 * that crosses the fewest.
 */
export function unfoldTo(tree: Tree, collapsed: Collapsed, id: string): Collapsed {
  const g = graphOf(tree);
  const target = g.at.get(id);
  if (target === undefined || collapsed.size === 0) return collapsed;

  const n = g.ids.length;
  const cost = new Float64Array(n).fill(Infinity);
  const via = new Int32Array(n).fill(-1);
  const opened: (string | null)[] = new Array<string | null>(n).fill(null);
  const deque = [...g.roots];
  for (const r of g.roots) cost[r] = 0;

  while (deque.length) {
    const cur = deque.shift()!;
    const step = (next: number, key: string | null) => {
      const fold = key !== null && collapsed.has(key);
      const total = cost[cur] + (fold ? 1 : 0);
      if (total >= cost[next]) return;
      cost[next] = total;
      via[next] = cur;
      opened[next] = fold ? key : null;
      if (fold) deque.push(next);
      else deque.unshift(next);
    };
    for (const p of g.partners[cur]) step(p, null);
    for (const p of g.parents[cur]) step(p, g.upKeys[cur]);
    for (const fam of g.families[cur]) for (const c of fam.children) step(c, fam.key);
  }

  const next = new Set(collapsed);
  for (let cur = target; via[cur] !== -1; cur = via[cur]) {
    const key = opened[cur];
    if (key) next.delete(key);
  }
  if (next.size === collapsed.size) return collapsed;
  return next.size ? next : NOTHING_COLLAPSED;
}

/**
 * The tree with only the visible people and couples - what the layout is computed from.
 * People keep their full `parentIds`; links to someone hidden simply aren't drawn.
 */
export function subTree(tree: Tree, visible: ReadonlySet<string>): Tree {
  const ids = Object.keys(tree.people);
  if (ids.every((id) => visible.has(id))) return tree;
  const people: Tree['people'] = {};
  for (const id of ids) if (visible.has(id)) people[id] = tree.people[id];
  return {
    ...tree,
    people,
    unions: tree.unions.filter((u) => visible.has(u.a) && visible.has(u.b)),
    homeId: tree.homeId && visible.has(tree.homeId) ? tree.homeId : null,
  };
}
