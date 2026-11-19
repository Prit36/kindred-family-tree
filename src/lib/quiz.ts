import type { Person, Tree } from '../types';
import { cardStats, hasCard } from './cards';
import { parentsOf, partnersOf, shortName } from './tree';

/**
 * Who's who?: a relative's card is turned over and you say what they are to you, in the
 * words the app is set to (કાકા, Masi, Cousin…). Rounds start with close family and reach
 * further out as they go; people you haven't named yet come up first.
 */

export interface Question {
  /** Who is asked about; their own word is the right answer */
  id: string;
  /**
   * Four people whose words are the choices, `id` among them. Kept as people rather than
   * words so the choices follow the app into English or Gujarati mid-round.
   */
  choices: string[];
}

export const ROUND = 10;

/** A random number source that can be seeded, so a round can be replayed in tests. */
export function rng(seed = Date.now()): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const names = (people: Person[]) =>
  people.length === 2 ? `${shortName(people[0])} & ${shortName(people[1])}` : people.map(shortName).join(', ');

export function clueFor(tree: Tree, p: Person): string {
  const parents = parentsOf(tree, p.id).filter(hasCard);
  if (parents.length) return `${p.gender === 'male' ? 'Son' : p.gender === 'female' ? 'Daughter' : 'Child'} of ${names(parents)}`;
  const partners = partnersOf(tree, p.id).map((x) => x.person).filter(hasCard);
  if (partners.length) return `${p.gender === 'male' ? 'Husband' : p.gender === 'female' ? 'Wife' : 'Partner'} of ${names(partners)}`;
  return '';
}

/**
 * A round of questions about the people in `pool`: the first few within two steps of you,
 * then three, then anyone. Each has four choices, the wrong ones said of people of the
 * same sex at about the same distance, so they are worth thinking about. `wordings` are
 * everyone's words in each language: a wrong choice must differ from the answer, and from
 * the other choices, in all of them.
 */
export function makeRound(
  tree: Tree,
  pool: string[],
  wordings: Map<string, string>[],
  known: ReadonlySet<string>,
  rand: () => number,
): Question[] {
  const labels = wordings[0];
  const stats = cardStats(tree);
  const askable = pool.filter((id) => {
    const p = tree.people[id];
    return id !== tree.homeId && hasCard(p) && labels.get(id) && stats.get(id)?.dist !== null;
  });
  if (askable.length === 0) return [];

  // The wrong answers on offer: one person for every distinct word said in the tree.
  const words = new Map<string, { id: string; gender: Person['gender']; dist: number }>();
  for (const [id, label] of labels) {
    const p = tree.people[id];
    const dist = stats.get(id)?.dist;
    if (!p || id === tree.homeId || dist == null || words.has(label)) continue;
    words.set(label, { id, gender: p.gender, dist });
  }
  const differs = (a: string, b: string) => wordings.every((w) => (w.get(a) ?? '') !== (w.get(b) ?? ''));

  const steps = [2, 2, 2, 3, 3, 3, 4, 5, 6, 99];
  const picked: string[] = [];
  const taken = new Set<string>();
  for (let q = 0; q < Math.min(ROUND, askable.length); q++) {
    const reach = steps[q] ?? 99;
    const near = askable.filter((id) => !taken.has(id) && (stats.get(id)!.dist ?? 99) <= reach);
    const pool2 = near.length ? near : askable.filter((id) => !taken.has(id));
    if (!pool2.length) break;
    const fresh = pool2.filter((id) => !known.has(id));
    // Mostly people not named yet, now and then an old friend.
    const from = fresh.length && (rand() < 0.8 || fresh.length === pool2.length) ? fresh : pool2;
    const id = from[Math.floor(rand() * from.length)];
    taken.add(id);
    picked.push(id);
  }

  return picked.map((id) => {
    const p = tree.people[id];
    const dist = stats.get(id)!.dist ?? 0;
    const others = [...words.values()].filter((v) => differs(v.id, id));
    const close = others.filter((v) => v.gender === p.gender && Math.abs(v.dist - dist) <= 1);
    const sameSex = others.filter((v) => v.gender === p.gender);
    const wrong: string[] = [];
    for (const list of [close, sameSex, others]) {
      for (const v of shuffle(list, rand)) {
        if (wrong.length >= 3) break;
        if (wrong.every((w) => differs(w, v.id))) wrong.push(v.id);
      }
    }
    return { id, choices: shuffle([id, ...wrong], rand) };
  });
}

/** A few words for the score at the end of a round. */
export function verdict(score: number, of: number): string {
  const r = of ? score / of : 0;
  if (r === 1) return 'Perfect round. The whole family would be proud.';
  if (r >= 0.8) return 'You know your family well.';
  if (r >= 0.5) return 'Not bad. A few relatives to catch up with.';
  return 'Time for a family get-together.';
}
