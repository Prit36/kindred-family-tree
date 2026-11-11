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

export function shapeOf(tree: Tree): Shape {
  let token = byTree.get(tree);
  if (token) return token;
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
  byTree.set(tree, token);
  return token;
}
