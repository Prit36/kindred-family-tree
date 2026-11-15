import type { Gender, Person, Relation, Tree } from '../types';

/*
 * Gujarati full names are written given name, father's name, surname: Prit Bharatbhai
 * Prajapati. A married woman takes her husband's name in the middle: Vidhi Pritbhai
 * Prajapati. The middle name only repeats who someone's father or husband is, so it isn't
 * stored: a tree that follows this custom (`tree.patronymic`) keeps just the given name
 * and works the middle name out from the tree whenever it is shown. `middleName` holds one
 * only where the tree can't say it - the father or husband isn't in the tree, or the name
 * written for them differs.
 */

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const isInitial = (t: string) => /^[a-z]\.?$/i.test(t);
/** Respectful endings, set aside when comparing names: Bharat, Bharatbhai and Bharatkumar are one man. */
const HONORIFIC = /(bhai|ben|bahen|behen|kumari|kumar)$/;
const core = (t: string) => {
  const lower = t.toLowerCase().replace(/\.$/, '');
  return lower.replace(HONORIFIC, '') || lower;
};

/** Whether a written middle name ("B.", "Bhupendra", "Bhupendrabhai") names the man it's derived from. */
function namesSame(written: string, derived: string): boolean {
  if (!derived) return false;
  if (isInitial(written)) return core(derived)[0] === written[0].toLowerCase();
  return core(written) === core(derived);
}

/** Each married woman's husband, by her id: the marriage that isn't over, if there is one (memoised per unions list). */
const husbandsCache = new WeakMap<Tree['unions'], Map<string, string>>();
function husbands(tree: Tree): Map<string, string> {
  let out = husbandsCache.get(tree.unions);
  if (out) return out;
  out = new Map();
  const ranked = [...tree.unions].sort((a, b) => Number(a.status === 'divorced') - Number(b.status === 'divorced'));
  for (const u of ranked) {
    for (const [wife, husband] of [[u.a, u.b], [u.b, u.a]]) {
      if (out.has(wife) || tree.people[wife]?.gender !== 'female' || tree.people[husband]?.gender !== 'male') continue;
      out.set(wife, husband);
    }
  }
  husbandsCache.set(tree.unions, out);
  return out;
}

/** A man's given name as it is written after his child's or wife's: "Bharat" → "Bharatbhai". */
export function middleNameFrom(giver: Person | undefined): string {
  const given = giver ? words(giver.firstName)[0] : undefined;
  if (!given || isInitial(given)) return '';
  return /(bhai|kumar)$/i.test(given) ? given : `${given}bhai`;
}

/** The father of someone, if he is in the tree. */
const fatherOf = (tree: Tree, p: Pick<Person, 'parentIds'>) =>
  p.parentIds.map((id) => tree.people[id]).find((q) => q?.gender === 'male');

/** The middle name the tree gives someone: their husband's given name for a wife, otherwise their father's - "Bharatbhai". */
export function derivedMiddleName(tree: Tree, p: Person): string {
  const husband = p.gender === 'female' ? husbands(tree).get(p.id) : undefined;
  return middleNameFrom(husband ? tree.people[husband] : fatherOf(tree, p));
}

/**
 * The middle name someone about to be added will get from the tree: from the father of
 * a new child, the husband of a new wife, the father a new sibling shares.
 */
export function middleNameForNew(tree: Tree, anchor: Person, relation: Relation, gender: Gender, otherParentId: string): string {
  switch (relation) {
    case 'child':
      return middleNameFrom([anchor, tree.people[otherParentId]].find((q) => q?.gender === 'male'));
    case 'partner':
      return gender === 'female' && anchor.gender === 'male' ? middleNameFrom(anchor) : '';
    case 'sibling':
      return middleNameFrom(fatherOf(tree, anchor));
    case 'parent':
      return '';
  }
}

const middleCache = new WeakMap<Tree, Map<string, string>>();

/** Someone's middle name in English letters - written down, or worked out from the tree. */
export function middleNameOf(tree: Tree, p: Person): string {
  const own = p.middleName.trim();
  if (!tree.patronymic) return own;
  let perTree = middleCache.get(tree);
  if (!perTree) middleCache.set(tree, (perTree = new Map()));
  let out = perTree.get(p.id);
  if (out !== undefined) return out;
  const derived = derivedMiddleName(tree, p);
  // An initial ("B.") gives way to the name it stands for once the tree knows it.
  out = !own || (isInitial(own) && namesSame(own, derived)) ? derived : own;
  perTree.set(p.id, out);
  return out;
}

/**
 * Whether the tree's names follow the custom: most people written with a second name
 * have their father's or husband's name there.
 */
function followsCustom(tree: Tree): boolean {
  let written = 0;
  let matching = 0;
  for (const p of Object.values(tree.people)) {
    const w = words(p.firstName);
    if (w.length < 2) continue;
    written++;
    if (w.length === 2 && namesSame(w[1], derivedMiddleName(tree, p))) matching++;
  }
  return matching >= 2 && matching * 2 >= written;
}

/**
 * The tree with father's and husband's names taken out of people's given names, where
 * the custom is followed: dropped where the tree already says them, otherwise kept as
 * `middleName`. Returns the same tree when there is nothing to change, and the same
 * person objects for everyone whose name is already tidy.
 */
export function adoptPatronymics(tree: Tree): Tree {
  const adopting = !tree.patronymic;
  if (adopting && !followsCustom(tree)) return tree;
  let people: Record<string, Person> | null = null;
  for (const p of Object.values(tree.people)) {
    const w = words(p.firstName);
    if (w.length < 2) continue;
    const rest = w.slice(1).join(' ');
    const said = w.length === 2 && !p.middleName.trim() && namesSame(w[1], derivedMiddleName(tree, p));
    people ??= { ...tree.people };
    people[p.id] = { ...p, firstName: w[0], middleName: said ? '' : [rest, p.middleName.trim()].filter(Boolean).join(' ') };
  }
  if (!people && !adopting) return tree;
  return { ...tree, people: people ?? tree.people, patronymic: true };
}

/**
 * A middle name as typed for someone, emptied when the tree already says it, so it
 * follows the tree from then on (a daughter's changes to her husband's when she marries).
 */
export function tidyMiddleName(tree: Tree, id: string): Tree {
  const p = tree.people[id];
  if (!tree.patronymic || !p) return tree;
  const w = words(p.firstName);
  let middle = [w.slice(1).join(' '), p.middleName.trim()].filter(Boolean).join(' ');
  // "Prit Bharatbhai" typed as the first name: the second part is the father's name.
  if (words(middle).length === 1 && namesSame(middle, derivedMiddleName(tree, p))) middle = '';
  if (w.length <= 1 && middle === p.middleName) return tree;
  return { ...tree, people: { ...tree.people, [id]: { ...p, firstName: w[0] ?? '', middleName: middle } } };
}
