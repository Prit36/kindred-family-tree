import { shapeOf, type Shape } from './shape';
import type { Tree } from '../types';
import { ancestorIds, descendantIds, indexOf, partnersOf, siblingsOf } from './tree';
import { LruMap } from './lru';
import { sideMembers } from './sides';

/**
 * Which part of a large tree is drawn.
 *
 * Two independent ways to cut a tree down to size:
 *
 * - **Focus** shows one person's branch on its own - their direct line, their whole
 *   family by blood, or their close family (see FocusScope).
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

const graphCache = new WeakMap<Shape, Graph>();

function graphOf(tree: Tree): Graph {
  let g = graphCache.get(shapeOf(tree));
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

  graphCache.set(shapeOf(tree), g);
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

/**
 * How many people each fold hides (or, for one already folded, would bring back), all
 * worked out at once.
 *
 * Every fold is a gate in the graph that `reach` walks: a node between a couple and their
 * children, or between a person and their parents. Closing an open gate hides exactly the
 * people who can only be reached through it - the ones it *dominates* - so one dominator
 * tree (Cooper, Harvey & Kennedy's iterative algorithm) answers every open fold together,
 * instead of walking the whole tree again for each one. Folds that are already closed are
 * few (the user closed them), so each is simply opened and walked from.
 */
function foldCounts(g: Graph, collapsed: Collapsed, base: Uint8Array): Map<string, number> {
  const n = g.ids.length;
  const famIndex = new Map(g.allFamilies.map((f, i) => [f, i]));
  const F = g.allFamilies.length;
  const FAM = n; // family gates: FAM + family index
  const UP = n + F; // parent gates: UP + person index
  const ROOT = n + F + n;
  const total = ROOT + 1;

  const successors = (v: number, visit: (w: number) => void) => {
    if (v === ROOT) {
      for (const r of g.roots) visit(r);
    } else if (v < n) {
      for (const p of g.partners[v]) visit(p);
      if (g.parents[v].length && !collapsed.has(g.upKeys[v])) visit(UP + v);
      for (const fam of g.families[v]) if (!collapsed.has(fam.key)) visit(FAM + famIndex.get(fam)!);
    } else if (v < UP) {
      for (const c of g.allFamilies[v - FAM].children) visit(c);
    } else {
      for (const p of g.parents[v - UP]) visit(p);
    }
  };

  // Reverse postorder from the root (iterative depth-first walk).
  const order = new Int32Array(total).fill(-1); // position in reverse postorder
  const post: number[] = [];
  const preds: number[][] = Array.from({ length: total }, () => []);
  const visited = new Uint8Array(total);
  const stack: { v: number; next: number[]; i: number }[] = [];
  const open = (v: number) => {
    visited[v] = 1;
    const next: number[] = [];
    successors(v, (w) => next.push(w));
    stack.push({ v, next, i: 0 });
  };
  open(ROOT);
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.i < top.next.length) {
      const w = top.next[top.i++];
      preds[w].push(top.v);
      if (!visited[w]) open(w);
    } else {
      post.push(top.v);
      stack.pop();
    }
  }
  const rpo = post.reverse();
  rpo.forEach((v, i) => (order[v] = i));

  // Immediate dominators.
  const idom = new Int32Array(total).fill(-1);
  idom[ROOT] = ROOT;
  const intersect = (a: number, b: number) => {
    while (a !== b) {
      while (order[a] > order[b]) a = idom[a];
      while (order[b] > order[a]) b = idom[b];
    }
    return a;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 1; i < rpo.length; i++) {
      const v = rpo[i];
      let d = -1;
      for (const p of preds[v]) {
        if (idom[p] === -1) continue;
        d = d === -1 ? p : intersect(p, d);
      }
      if (d !== -1 && idom[v] !== d) {
        idom[v] = d;
        changed = true;
      }
    }
  }

  // People under each node of the dominator tree (a node comes after its dominator in rpo).
  const under = new Int32Array(total);
  for (let i = rpo.length - 1; i > 0; i--) {
    const v = rpo[i];
    if (v < n) under[v]++;
    under[idom[v]] += under[v];
  }

  const out = new Map<string, number>();
  g.allFamilies.forEach((fam, i) => {
    if (!collapsed.has(fam.key)) out.set(fam.key, under[FAM + i]);
  });
  for (let i = 0; i < n; i++) if (g.parents[i].length && !collapsed.has(g.upKeys[i])) out.set(g.upKeys[i], under[UP + i]);

  // Folds already closed: open each one alone and count who comes back.
  const stamp = new Int32Array(n);
  let round = 0;
  const regained = (starts: number[]) => {
    round++;
    let count = 0;
    const todo: number[] = [];
    const visit = (w: number) => {
      if (w >= n) {
        successors(w, visit);
        return;
      }
      if (base[w] || stamp[w] === round) return;
      stamp[w] = round;
      count++;
      todo.push(w);
    };
    for (const s of starts) visit(s);
    while (todo.length) successors(todo.pop()!, visit);
    return count;
  };
  for (const key of collapsed) {
    if (key.startsWith('up:')) {
      const i = g.at.get(key.slice(3));
      if (i !== undefined && base[i]) out.set(key, regained(g.parents[i]));
    } else {
      const fam = g.allFamilies.find((f) => f.key === key);
      if (fam && base[fam.parents[0]]) out.set(key, regained(fam.children));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

/**
 * How much of the tree around a person a focus keeps:
 *
 * - `line`: their direct line - ancestors, descendants and immediate family.
 * - `family`: everyone related to them by blood - ancestors, and every descendant of those
 *   ancestors (aunts, uncles, cousins…) - with partners. Focusing on your father this way
 *   shows your father's side of the family; on your brother's wife, her family.
 * - `close`: their parents and everyone descended from them (siblings, nieces and nephews),
 *   their own descendants, and partners.
 * - `side`: one side of the home person's family (lib/sides.ts) - the one this person is
 *   the root of, like "Father's side" for your father - drawn with your close family and
 *   the line linking it to you.
 */
export type FocusScope = 'line' | 'family' | 'close' | 'side';

export interface Focus {
  id: string;
  scope: FocusScope;
}

export const sameFocus = (a: Focus | null, b: Focus | null) =>
  a === b || (a !== null && b !== null && a.id === b.id && a.scope === b.scope);

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

/**
 * Everyone descended from `roots` (and the roots themselves), with their partners so
 * every couple is drawn whole - but not the partners' own relatives.
 */
function withDescendantsAndPartners(tree: Tree, roots: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [];
  for (const r of roots) {
    if (!tree.people[r] || out.has(r)) continue;
    out.add(r);
    stack.push(r);
  }
  const children = indexOf(tree).children;
  while (stack.length) {
    for (const id of children.get(stack.pop()!) ?? []) {
      if (out.has(id)) continue;
      out.add(id);
      stack.push(id);
    }
  }
  for (const id of [...out]) for (const { person } of partnersOf(tree, id)) out.add(person.id);
  return out;
}

const focusCache = new WeakMap<Shape, Map<string, ReadonlySet<string>>>();

/** The people a focus keeps on screen. */
export function focusSet(tree: Tree, focus: Focus): ReadonlySet<string> {
  let perTree = focusCache.get(shapeOf(tree));
  if (!perTree) focusCache.set(shapeOf(tree), (perTree = new LruMap(16)));
  const key = `${focus.scope}:${focus.id}`;
  let ids = perTree.get(key);
  if (ids) return ids;

  const { id } = focus;
  if (!tree.people[id]) ids = new Set();
  else if (focus.scope === 'line') ids = branchOf(tree, id);
  else if (focus.scope === 'family') ids = withDescendantsAndPartners(tree, [id, ...ancestorIds(tree, id)]);
  else if (focus.scope === 'side') ids = sideMembers(tree, id);
  else ids = withDescendantsAndPartners(tree, [id, ...tree.people[id].parentIds]);
  perTree.set(key, ids);
  return ids;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

const visibleCache = new WeakMap<Shape, { focus: Focus | null; collapsed: Collapsed; ids: ReadonlySet<string> }>();

/** The people drawn on the canvas for this focus and these folds. */
export function visibleIds(tree: Tree, focus: Focus | null, collapsed: Collapsed): ReadonlySet<string> {
  const hit = visibleCache.get(shapeOf(tree));
  if (hit && sameFocus(hit.focus, focus) && hit.collapsed === collapsed) return hit.ids;

  let ids: ReadonlySet<string>;
  if (focus && tree.people[focus.id]) {
    ids = focusSet(tree, focus);
  } else {
    const g = graphOf(tree);
    const seen = reach(g, collapsed);
    const reached = new Set<string>();
    g.ids.forEach((id, i) => {
      if (seen[i]) reached.add(id);
    });
    ids = reached;
  }
  visibleCache.set(shapeOf(tree), { focus, collapsed, ids });
  return ids;
}

const toggleCache = new WeakMap<Shape, { collapsed: Collapsed; toggles: BranchToggle[] }>();

/**
 * Every place the tree can be folded or unfolded right now. A fold that wouldn't hide
 * anybody (an only child's parents, say) isn't offered.
 */
export function branchToggles(tree: Tree, collapsed: Collapsed): BranchToggle[] {
  const hit = toggleCache.get(shapeOf(tree));
  if (hit && hit.collapsed === collapsed) return hit.toggles;

  const g = graphOf(tree);
  const base = reach(g, collapsed);
  const hides = foldCounts(g, collapsed, base);
  const effect = (key: string) => hides.get(key) ?? 0;

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

  toggleCache.set(shapeOf(tree), { collapsed, toggles });
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
  // Fewest folds opened: a breadth-first walk one fold-count at a time (crossing a closed
  // fold costs 1, anything else 0), so each person is settled at their lowest count.
  let level = [...g.roots];
  let after: number[] = [];
  for (const r of g.roots) cost[r] = 0;
  for (let depth = 0; level.length; depth++) {
    for (let i = 0; i < level.length; i++) {
      const cur = level[i];
      if (cost[cur] !== depth) continue; // reached more cheaply since it was queued
      const step = (next: number, key: string | null) => {
        const fold = key !== null && collapsed.has(key);
        const total = depth + (fold ? 1 : 0);
        if (total >= cost[next]) return;
        cost[next] = total;
        via[next] = cur;
        opened[next] = fold ? key : null;
        (fold ? after : level).push(next);
      };
      for (const p of g.partners[cur]) step(p, null);
      for (const p of g.parents[cur]) step(p, g.upKeys[cur]);
      for (const fam of g.families[cur]) for (const c of fam.children) step(c, fam.key);
    }
    [level, after] = [after, []];
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
