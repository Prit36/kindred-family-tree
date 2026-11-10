import type { Person, PersonInput, Tree, Union, UnionStatus } from '../types';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function emptyTree(): Tree {
  return { version: 1, name: 'My Family', people: {}, unions: [], homeId: null };
}

export function blankInput(partial: Partial<PersonInput> = {}): PersonInput {
  return {
    firstName: '',
    lastName: '',
    gender: 'other',
    birthDate: '',
    deathDate: '',
    deceased: false,
    birthPlace: '',
    photo: '',
    notes: '',
    ...partial,
  };
}

export function displayName(p: Person | undefined): string {
  if (!p) return 'Unknown';
  const name = `${p.firstName} ${p.lastName}`.trim();
  return name || 'Unknown';
}

export function shortName(p: Person | undefined): string {
  if (!p) return 'Unknown';
  return p.firstName.trim() || p.lastName.trim() || 'Unknown';
}

export function initials(p: Pick<Person, 'firstName' | 'lastName'>): string {
  const a = p.firstName.trim()[0] ?? '';
  const b = p.lastName.trim()[0] ?? '';
  return (a + b).toUpperCase() || '?';
}

// ---------------------------------------------------------------------------
// Index (memoised per tree object, trees are immutable)
// ---------------------------------------------------------------------------

export interface TreeIndex {
  children: Map<string, string[]>;
  unions: Map<string, Union[]>;
}

const indexCache = new WeakMap<Tree, TreeIndex>();

export function indexOf(tree: Tree): TreeIndex {
  let idx = indexCache.get(tree);
  if (idx) return idx;
  const children = new Map<string, string[]>();
  const unions = new Map<string, Union[]>();
  for (const p of Object.values(tree.people)) {
    for (const pid of p.parentIds) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid)!.push(p.id);
    }
  }
  for (const u of tree.unions) {
    for (const id of [u.a, u.b]) {
      if (!unions.has(id)) unions.set(id, []);
      unions.get(id)!.push(u);
    }
  }
  idx = { children, unions };
  indexCache.set(tree, idx);
  return idx;
}

export function parentsOf(tree: Tree, id: string): Person[] {
  const p = tree.people[id];
  if (!p) return [];
  return p.parentIds.map((pid) => tree.people[pid]).filter(Boolean);
}

export function childrenOf(tree: Tree, id: string): Person[] {
  return (indexOf(tree).children.get(id) ?? []).map((cid) => tree.people[cid]).filter(Boolean);
}

export function unionsOf(tree: Tree, id: string): Union[] {
  return indexOf(tree).unions.get(id) ?? [];
}

export function partnerIn(u: Union, id: string): string {
  return u.a === id ? u.b : u.a;
}

export function partnersOf(tree: Tree, id: string): { person: Person; union: Union }[] {
  return unionsOf(tree, id)
    .map((union) => ({ person: tree.people[partnerIn(union, id)], union }))
    .filter((x) => x.person);
}

export function findUnion(tree: Tree, a: string, b: string): Union | undefined {
  return unionsOf(tree, a).find((u) => partnerIn(u, a) === b);
}

export function siblingsOf(tree: Tree, id: string): Person[] {
  const p = tree.people[id];
  if (!p) return [];
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const pid of p.parentIds) {
    for (const c of childrenOf(tree, pid)) {
      if (c.id !== id && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
  }
  return out;
}

export function sharedChildren(tree: Tree, a: string, b: string): Person[] {
  return childrenOf(tree, a).filter((c) => c.parentIds.includes(b));
}

export function ancestorIds(tree: Tree, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(tree.people[id]?.parentIds ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur) || !tree.people[cur]) continue;
    out.add(cur);
    stack.push(...tree.people[cur].parentIds);
  }
  return out;
}

export function descendantIds(tree: Tree, id: string): Set<string> {
  const idx = indexOf(tree);
  const out = new Set<string>();
  const stack = [...(idx.children.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(idx.children.get(cur) ?? []));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mutations (all return a new tree)
// ---------------------------------------------------------------------------

function putPerson(tree: Tree, p: Person): Tree {
  return { ...tree, people: { ...tree.people, [p.id]: p } };
}

export function createPerson(tree: Tree, input: PersonInput): { tree: Tree; id: string } {
  const id = uid();
  const person: Person = { ...input, id, parentIds: [] };
  let next = putPerson(tree, person);
  // The very first person added is assumed to be "me".
  if (!next.homeId && Object.keys(tree.people).length === 0) next = { ...next, homeId: id };
  return { tree: next, id };
}

export function updatePerson(tree: Tree, id: string, input: PersonInput): Tree {
  const cur = tree.people[id];
  if (!cur) return tree;
  return putPerson(tree, { ...cur, ...input });
}

export function ensureUnion(tree: Tree, a: string, b: string, status: UnionStatus = 'married'): Tree {
  if (a === b || findUnion(tree, a, b)) return tree;
  return { ...tree, unions: [...tree.unions, { id: uid(), a, b, status }] };
}

function setParents(tree: Tree, childId: string, parentIds: string[]): Tree {
  const child = tree.people[childId];
  const ids = [...new Set(parentIds)].filter((id) => tree.people[id] && id !== childId).slice(0, 2);
  let next = putPerson(tree, { ...child, parentIds: ids });
  if (ids.length === 2) next = ensureUnion(next, ids[0], ids[1]);
  return next;
}

export function linkParent(tree: Tree, childId: string, parentId: string): Tree {
  const child = tree.people[childId];
  if (!child || child.parentIds.length >= 2 || child.parentIds.includes(parentId)) return tree;
  return setParents(tree, childId, [...child.parentIds, parentId]);
}

export function linkPartner(tree: Tree, a: string, b: string, status: UnionStatus): Tree {
  return ensureUnion(tree, a, b, status);
}

export function linkChild(tree: Tree, parentId: string, otherParentId: string | null, childId: string): Tree {
  const child = tree.people[childId];
  if (!child) return tree;
  const ids = [...child.parentIds];
  for (const pid of [parentId, otherParentId]) {
    if (pid && !ids.includes(pid) && ids.length < 2) ids.push(pid);
  }
  return setParents(tree, childId, ids);
}

/**
 * Siblings are connected through shared parents. If neither person has parents yet,
 * two placeholder parents are created so the link can exist.
 */
export function linkSibling(tree: Tree, personId: string, siblingId: string): { tree: Tree; placeholders: boolean } {
  const person = tree.people[personId];
  const sibling = tree.people[siblingId];
  if (!person || !sibling) return { tree, placeholders: false };
  if (person.parentIds.length > 0 && sibling.parentIds.length === 0) {
    return { tree: setParents(tree, siblingId, person.parentIds), placeholders: false };
  }
  if (person.parentIds.length === 0 && sibling.parentIds.length > 0) {
    return { tree: setParents(tree, personId, sibling.parentIds), placeholders: false };
  }
  if (person.parentIds.length === 0 && sibling.parentIds.length === 0) {
    const father = createPerson(tree, blankInput({ gender: 'male' }));
    const mother = createPerson(father.tree, blankInput({ gender: 'female' }));
    let next = mother.tree;
    next = setParents(next, personId, [father.id, mother.id]);
    next = setParents(next, siblingId, [father.id, mother.id]);
    return { tree: next, placeholders: true };
  }
  return { tree, placeholders: false };
}

export function unlinkParent(tree: Tree, childId: string, parentId: string): Tree {
  const child = tree.people[childId];
  if (!child) return tree;
  return putPerson(tree, { ...child, parentIds: child.parentIds.filter((id) => id !== parentId) });
}

export function setUnionStatus(tree: Tree, unionId: string, status: UnionStatus): Tree {
  return { ...tree, unions: tree.unions.map((u) => (u.id === unionId ? { ...u, status } : u)) };
}

export function removeUnion(tree: Tree, unionId: string): Tree {
  const u = tree.unions.find((x) => x.id === unionId);
  if (!u || sharedChildren(tree, u.a, u.b).length > 0) return tree;
  return { ...tree, unions: tree.unions.filter((x) => x.id !== unionId) };
}

export function deletePerson(tree: Tree, id: string): Tree {
  if (!tree.people[id]) return tree;
  const people: Record<string, Person> = {};
  for (const p of Object.values(tree.people)) {
    if (p.id === id) continue;
    people[p.id] = p.parentIds.includes(id) ? { ...p, parentIds: p.parentIds.filter((x) => x !== id) } : p;
  }
  return {
    ...tree,
    people,
    unions: tree.unions.filter((u) => u.a !== id && u.b !== id),
    homeId: tree.homeId === id ? null : tree.homeId,
  };
}

// ---------------------------------------------------------------------------
// Candidates for "link someone already in the tree"
// ---------------------------------------------------------------------------

export function parentCandidates(tree: Tree, childId: string): Person[] {
  const child = tree.people[childId];
  if (!child || child.parentIds.length >= 2) return [];
  const blocked = descendantIds(tree, childId);
  const partners = new Set(partnersOf(tree, childId).map((x) => x.person.id));
  return Object.values(tree.people).filter(
    (p) => p.id !== childId && !blocked.has(p.id) && !child.parentIds.includes(p.id) && !partners.has(p.id),
  );
}

export function partnerCandidates(tree: Tree, id: string): Person[] {
  const blocked = new Set([...ancestorIds(tree, id), ...descendantIds(tree, id)]);
  const partners = new Set(partnersOf(tree, id).map((x) => x.person.id));
  return Object.values(tree.people).filter((p) => p.id !== id && !blocked.has(p.id) && !partners.has(p.id));
}

export function childCandidates(tree: Tree, parentId: string): Person[] {
  const blocked = ancestorIds(tree, parentId);
  const partners = new Set(partnersOf(tree, parentId).map((x) => x.person.id));
  return Object.values(tree.people).filter(
    (p) =>
      p.id !== parentId &&
      !blocked.has(p.id) &&
      !partners.has(p.id) &&
      p.parentIds.length < 2 &&
      !p.parentIds.includes(parentId),
  );
}

export function siblingCandidates(tree: Tree, id: string): Person[] {
  const person = tree.people[id];
  if (!person) return [];
  const blocked = new Set([...ancestorIds(tree, id), ...descendantIds(tree, id)]);
  const partners = new Set(partnersOf(tree, id).map((x) => x.person.id));
  const siblings = new Set(siblingsOf(tree, id).map((s) => s.id));
  return Object.values(tree.people).filter(
    (p) =>
      p.id !== id &&
      !blocked.has(p.id) &&
      !partners.has(p.id) &&
      !siblings.has(p.id) &&
      (p.parentIds.length === 0 || person.parentIds.length === 0),
  );
}

// ---------------------------------------------------------------------------
// Import / validation
// ---------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Accepts anything parsed from JSON and returns a well-formed tree, or throws. */
export function sanitizeTree(raw: unknown): Tree {
  if (!raw || typeof raw !== 'object') throw new Error('Not a family tree file');
  const src = raw as Record<string, unknown>;
  if (!src.people || typeof src.people !== 'object') throw new Error('Not a family tree file');

  const people: Record<string, Person> = {};
  for (const [id, value] of Object.entries(src.people as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const gender = v.gender === 'male' || v.gender === 'female' ? v.gender : 'other';
    const photo = str(v.photo);
    people[id] = {
      id,
      firstName: str(v.firstName),
      lastName: str(v.lastName),
      gender,
      birthDate: str(v.birthDate),
      deathDate: str(v.deathDate),
      deceased: Boolean(v.deceased) || Boolean(str(v.deathDate)),
      birthPlace: str(v.birthPlace),
      photo: photo.startsWith('data:image/') ? photo : '',
      notes: str(v.notes),
      parentIds: Array.isArray(v.parentIds) ? v.parentIds.filter((x): x is string => typeof x === 'string') : [],
    };
  }
  for (const p of Object.values(people)) {
    p.parentIds = [...new Set(p.parentIds)].filter((pid) => people[pid] && pid !== p.id).slice(0, 2);
  }
  // Break any ancestry cycles a hand-edited file might contain.
  for (const p of Object.values(people)) {
    const seen = new Set<string>();
    const stack = [...p.parentIds];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === p.id) {
        p.parentIds = [];
        break;
      }
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...people[cur].parentIds);
    }
  }

  const unions: Union[] = [];
  const pairSeen = new Set<string>();
  if (Array.isArray(src.unions)) {
    for (const value of src.unions) {
      if (!value || typeof value !== 'object') continue;
      const u = value as Record<string, unknown>;
      const a = str(u.a);
      const b = str(u.b);
      if (!people[a] || !people[b] || a === b) continue;
      const key = [a, b].sort().join('|');
      if (pairSeen.has(key)) continue;
      pairSeen.add(key);
      const status: UnionStatus = u.status === 'divorced' || u.status === 'partner' ? u.status : 'married';
      unions.push({ id: str(u.id) || uid(), a, b, status });
    }
  }

  let tree: Tree = {
    version: 1,
    name: str(src.name) || 'My Family',
    people,
    unions,
    homeId: typeof src.homeId === 'string' && people[src.homeId] ? src.homeId : null,
  };
  for (const p of Object.values(people)) {
    if (p.parentIds.length === 2) tree = ensureUnion(tree, p.parentIds[0], p.parentIds[1]);
  }
  return tree;
}
