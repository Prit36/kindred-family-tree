import type { Person, Tree } from '../types';
import { focusSet } from './branches';
import { ageOf, birthSortKey, yearOf } from './dates';
import { descendantCount, isNameless } from './fan';
import { gujaratiKinship } from './gujarati';
import type { Naming } from './naming';
import { RecentMap } from './lru';
import { shapeOf, type Shape } from './shape';
import { indexOf, partnerIn } from './tree';

/**
 * Family cards: everyone as a collectible card. How rare a card is comes from the size of
 * the family someone heads and how long they've lived, measured across the whole tree so a
 * card looks the same in every deck.
 */

export type Rarity = 'legend' | 'rare' | 'common';

export interface CardStats {
  /** Generations above "me" (parents 1, children -1); null when not linked to them */
  gen: number | null;
  /** Steps from "me" through parents, children and couples; null when not linked */
  dist: number | null;
  descendants: number;
  children: number;
  age: number | null;
  rarity: Rarity;
  /** Each child, with how old this person was when they were born (null when a year is missing) */
  kids: { at: number | null; gender: Person['gender'] }[];
}

export type DeckKind = 'close' | 'family' | 'all';

export const DECKS: { kind: DeckKind; label: string; tip: string }[] = [
  { kind: 'close', label: 'Close family', tip: 'Parents, brothers and sisters, children and their partners' },
  { kind: 'family', label: 'Your family', tip: 'Every blood relative and their partners' },
  { kind: 'all', label: 'Everyone', tip: 'Every person in the tree' },
];

/** Steps and generations from `homeId` to everyone linked to them. */
function walkFrom(tree: Tree, homeId: string | null): Map<string, { gen: number; dist: number }> {
  const out = new Map<string, { gen: number; dist: number }>();
  if (!homeId || !tree.people[homeId]) return out;
  const idx = indexOf(tree);
  out.set(homeId, { gen: 0, dist: 0 });
  let frontier = [homeId];
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      const { gen, dist } = out.get(cur)!;
      const visit = (id: string, g: number) => {
        if (out.has(id) || !tree.people[id]) return;
        out.set(id, { gen: g, dist: dist + 1 });
        next.push(id);
      };
      for (const p of tree.people[cur].parentIds) visit(p, gen + 1);
      for (const c of idx.children.get(cur) ?? []) visit(c, gen - 1);
      for (const u of idx.unions.get(cur) ?? []) visit(partnerIn(u, cur), gen);
    }
    frontier = next;
  }
  return out;
}

const statsCache = new RecentMap<Shape, { home: string | null; stats: Map<string, CardStats> }>(4);

/** Everyone's card numbers, worked out once per tree. */
export function cardStats(tree: Tree): Map<string, CardStats> {
  const shape = shapeOf(tree);
  const hit = statsCache.get(shape);
  if (hit && hit.home === tree.homeId) return hit.stats;

  const walk = walkFrom(tree, tree.homeId);
  const idx = indexOf(tree);
  const people = Object.values(tree.people);
  const now = new Date();
  const scored = people.map((p) => {
    const descendants = descendantCount(tree, p.id);
    const age = ageOf(p, now);
    const living = !p.deceased && !p.deathDate;
    // A long life counts once it is past seventy, more so for someone still with us.
    const years = age !== null && age >= 70 ? (age - 65) / (living ? 3 : 5) : 0;
    return { p, descendants, age, score: descendants + years };
  });
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const n = ranked.length;
  const legends = Math.max(1, Math.round(n * 0.02));
  const rares = Math.max(2, Math.round(n * 0.12));
  const rarity = new Map<string, Rarity>();
  ranked.forEach(({ p, score }, i) => {
    rarity.set(p.id, i < legends && score >= 3 ? 'legend' : i < rares && score >= 1 ? 'rare' : 'common');
  });

  const stats = new Map<string, CardStats>();
  for (const { p, descendants, age } of scored) {
    const w = walk.get(p.id);
    const born = yearOf(p.birthDate);
    const kids = (idx.children.get(p.id) ?? [])
      .map((c) => tree.people[c])
      .filter(Boolean)
      .map((c) => {
        const y = yearOf(c.birthDate);
        return { at: born !== null && y !== null && y >= born ? y - born : null, gender: c.gender };
      });
    stats.set(p.id, {
      gen: w?.gen ?? null,
      dist: w?.dist ?? null,
      descendants,
      children: kids.length,
      age,
      rarity: rarity.get(p.id) ?? 'common',
      kids,
    });
  }
  statsCache.set(shape, { home: tree.homeId, stats });
  return stats;
}

/** Whether someone is worth a card: anyone with a name. */
export const hasCard = (p: Person | undefined): p is Person => Boolean(p) && !isNameless(p!);

/** The people in a deck, eldest generation first and by birth within it. */
export function deckOf(tree: Tree, kind: DeckKind): string[] {
  const home = tree.homeId && tree.people[tree.homeId] ? tree.homeId : null;
  let ids: Iterable<string>;
  if (kind === 'all' || !home) ids = Object.keys(tree.people);
  else ids = focusSet(tree, { id: home, scope: kind === 'close' ? 'close' : 'family' });
  const stats = cardStats(tree);
  return [...ids]
    .filter((id) => hasCard(tree.people[id]))
    .sort((a, b) => {
      const ga = stats.get(a)?.gen ?? -99;
      const gb = stats.get(b)?.gen ?? -99;
      if (ga !== gb) return gb - ga;
      return birthSortKey(tree.people[a]) - birthSortKey(tree.people[b]);
    });
}

export type CardSort = 'generation' | 'age' | 'family';

export const SORTS: { sort: CardSort; label: string }[] = [
  { sort: 'generation', label: 'By generation' },
  { sort: 'age', label: 'Eldest first' },
  { sort: 'family', label: 'Biggest family' },
];

export function sortDeck(tree: Tree, ids: string[], sort: CardSort): string[] {
  if (sort === 'generation') return ids;
  const stats = cardStats(tree);
  const out = [...ids];
  if (sort === 'age') out.sort((a, b) => birthSortKey(tree.people[a]) - birthSortKey(tree.people[b]));
  else out.sort((a, b) => (stats.get(b)?.descendants ?? 0) - (stats.get(a)?.descendants ?? 0) || birthSortKey(tree.people[a]) - birthSortKey(tree.people[b]));
  return out;
}

/** "Parents' generation", "Your generation", "Grandchildren" - for a heading over a row of cards. */
export function generationTitle(gen: number | null): string {
  if (gen === null) return 'Not linked to you';
  if (gen === 0) return 'Your generation';
  if (gen === 1) return "Parents' generation";
  if (gen === 2) return "Grandparents' generation";
  if (gen === 3) return "Great-grandparents' generation";
  if (gen > 3) return `${gen - 2}× great-grandparents' generation`;
  if (gen === -1) return "Children's generation";
  if (gen === -2) return "Grandchildren's generation";
  if (gen === -3) return "Great-grandchildren's generation";
  return `${-gen - 2}× great-grandchildren's generation`;
}

/** The deck's rarest cards, for the hand held up at the top: the home person among them. */
export function handOf(tree: Tree, ids: string[], size = 7): string[] {
  const stats = cardStats(tree);
  const order = { legend: 0, rare: 1, common: 2 } as const;
  const best = [...ids]
    .filter((id) => id !== tree.homeId)
    .sort((a, b) => {
      const sa = stats.get(a)!;
      const sb = stats.get(b)!;
      return order[sa.rarity] - order[sb.rarity] || sb.descendants - sa.descendants || (sb.age ?? 0) - (sa.age ?? 0);
    })
    .slice(0, tree.homeId && ids.includes(tree.homeId) ? size - 1 : size);
  // The home card in the middle of the fan, the rarest on either side of it.
  if (tree.homeId && ids.includes(tree.homeId)) best.splice(Math.floor(best.length / 2), 0, tree.homeId);
  return best;
}

/** The English meaning of a Gujarati relationship word, for under it on a card. */
export function meaningFor(tree: Tree, naming: Naming): (id: string) => string {
  if (naming === 'en') return () => '';
  const terms = gujaratiKinship(tree, tree.homeId);
  return (id: string) => terms.get(id)?.en ?? '';
}

export const RARITY_LABEL: Record<Rarity, string> = { legend: 'Legendary', rare: 'Rare', common: 'Common' };

/** The year to print on a card, or a dash. */
export const bornYear = (p: Person) => yearOf(p.birthDate);

// ---------------------------------------------------------------------------
// What the player has collected, kept in this browser
// ---------------------------------------------------------------------------

const KEY = 'kindred.cards.v1';

export interface Collection {
  /** People named correctly in Who's who? */
  known: string[];
  best: number;
  played: number;
}

export function loadCollection(): Collection {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const { known, best, played } = raw as Partial<Collection>;
      return {
        known: Array.isArray(known) ? known.filter((k): k is string => typeof k === 'string') : [],
        best: typeof best === 'number' ? best : 0,
        played: typeof played === 'number' ? played : 0,
      };
    }
  } catch {
    /* a fresh collection */
  }
  return { known: [], best: 0, played: 0 };
}

export function saveCollection(c: Collection) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* the collection just won't persist */
  }
}
