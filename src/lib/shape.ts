import type { Tree } from '../types';

/**
 * The parts of a tree that its structure-only calculations depend on: who is in it, who
 * their parents are, their gender and birth date, the couples, and who "me" is. Layout,
 * relationship names, sides membership and folds read nothing else.
 *
 * Trees are immutable, so those calculations are memoised per tree object - but editing
 * someone's notes, photo, name or birthplace makes a new tree object with the same
 * structure, and on a large tree redoing them all would make every such edit stall.
 * `shapeOf` gives trees with the same structure the same token, so caches keyed on the
 * token (a WeakMap, so nothing is held on to) survive those edits.
 */
export type Shape = Readonly<{ shape: true }>;

const byTree = new WeakMap<Tree, Shape>();
/** The structures seen most recently (undo and redo flip between a few). */
const recent: { key: string; token: Shape }[] = [];
const RECENT = 4;

function keyOf(tree: Tree): string {
  const parts: string[] = [tree.homeId ?? ''];
  for (const id in tree.people) {
    const p = tree.people[id];
    parts.push(`${id}:${p.gender}:${p.birthDate}:${p.parentIds.join(',')}`);
  }
  for (const u of tree.unions) parts.push(`${u.id}:${u.a}:${u.b}:${u.status}`);
  return parts.join('|');
}

/** The last few trees given a token, to compare new trees with directly. */
const lastTrees: { tree: Tree; token: Shape }[] = [];

const sameParents = (a: string[], b: string[]) => a === b || (a.length === b.length && a.every((id, i) => id === b[i]));

/**
 * Whether two trees have the same structure, compared directly - most new trees are one
 * edit away from the last, and keep most of its person objects and its unions array, so
 * this is a pass of reference checks instead of building the key string for thousands of people.
 */
function sameStructure(a: Tree, b: Tree): boolean {
  if (a.homeId !== b.homeId) return false;
  if (a.unions !== b.unions) {
    if (a.unions.length !== b.unions.length) return false;
    for (let i = 0; i < a.unions.length; i++) {
      const u = a.unions[i];
      const v = b.unions[i];
      if (u !== v && (u.id !== v.id || u.a !== v.a || u.b !== v.b || u.status !== v.status)) return false;
    }
  }
  if (a.people === b.people) return true;
  const ids = Object.keys(a.people);
  const others = Object.keys(b.people);
  if (ids.length !== others.length) return false;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (others[i] !== id) return false;
    const p = a.people[id];
    const q = b.people[id];
    if (p !== q && (p.gender !== q.gender || p.birthDate !== q.birthDate || !sameParents(p.parentIds, q.parentIds))) return false;
  }
  return true;
}

export function shapeOf(tree: Tree): Shape {
  let token = byTree.get(tree);
  if (token) return token;
  const i = lastTrees.findIndex((last) => sameStructure(tree, last.tree));
  token = i >= 0 ? lastTrees[i].token : tokenFor(tree);
  // The newest tree takes the place of the one it matched, which can then be let go.
  if (i >= 0) lastTrees.splice(i, 1);
  byTree.set(tree, token);
  lastTrees.unshift({ tree, token });
  if (lastTrees.length > RECENT) lastTrees.pop();
  return token;
}

/** The token for a structure not among the last few trees: found by its key, or new. */
function tokenFor(tree: Tree): Shape {
  let token: Shape;
  const key = keyOf(tree);
  const hit = recent.findIndex((r) => r.key === key);
  if (hit >= 0) {
    token = recent[hit].token;
    recent.splice(hit, 1);
  } else {
    token = Object.freeze({ shape: true as const });
  }
  recent.unshift({ key, token });
  if (recent.length > RECENT) recent.pop();
  return token;
}
