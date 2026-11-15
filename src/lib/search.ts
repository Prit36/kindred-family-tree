import type { Person, Tree } from '../types';
import { gujaratiName, latinName } from './tree';
import { middleNameOf } from './names';
import { relationSearchText } from './naming';
import { yearOf } from './dates';

interface Searchable {
  person: Person;
  display: string;
  name: string;
  fields: string[];
}

// Metadata belongs to immutable people, so editing one member needn't lowercase
// everyone else's notes again. Undo history must not retain assembled search indexes.
const metadata = new WeakMap<Person, Searchable & { spellings: Tree['spellings']; middle: string }>();
const indexes = new WeakMap<Tree, WeakRef<Searchable[]>>();

export function searchIndex(tree: Tree): Searchable[] {
  const hit = indexes.get(tree)?.deref();
  if (hit) return hit;
  const spellings = tree.spellings;
  const index = Object.values(tree.people).map((person) => {
    let entry = metadata.get(person);
    // The middle name comes from the father or husband, so it can change while the person doesn't.
    const middle = middleNameOf(tree, person);
    if (!entry || entry.spellings !== spellings || entry.middle !== middle) {
      const display = latinName(tree, person);
      // Found by name in either script, father's name included: "prit bharat" or "પ્રિત ભરત".
      const name = `${display} ${gujaratiName(tree, person, spellings)}`.toLowerCase();
      entry = { person, display, name, spellings, middle, fields: [
        person.birthName.toLowerCase(), '', person.birthPlace.toLowerCase(),
        `${yearOf(person.birthDate) ?? ''} ${yearOf(person.deathDate) ?? ''}`, person.notes.toLowerCase(),
      ] };
      metadata.set(person, entry);
    }
    const fields = [...entry.fields];
    fields[1] = relationSearchText(tree, person.id);
    return { ...entry, fields };
  }).sort((a, b) => a.display.localeCompare(b.display));
  indexes.set(tree, new WeakRef(index));
  return index;
}

export interface SearchHit {
  person: Person;
  rank: number;
  field: number;
  word: string;
}

/** Query the alphabetically ordered searchIndex, retaining just the visible results. */
export function searchPeople(index: Searchable[], query: string, limit = 8): SearchHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || limit <= 0) return [];
  const hits: SearchHit[] = [];
  for (const { person, name, fields } of index) {
    let rank = 0;
    let field = -1;
    let word = '';
    const ok = words.every((w) => {
      if (name.includes(w)) return true;
      const i = fields.findIndex((text) => text.includes(w));
      if (i < 0) return false;
      rank = Math.max(rank, i + 1);
      if (field < 0) [field, word] = [i, w];
      return true;
    });
    if (!ok) continue;
    if (rank === 0 && !name.startsWith(words[0])) rank = 0.5;
    // Entries already arrive alphabetically, so a later equal-rank match cannot
    // improve the visible set. No per-keystroke name comparisons are necessary.
    if (hits.length === limit && rank >= hits[hits.length - 1].rank) continue;
    let lo = 0;
    let hi = hits.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rank >= hits[mid].rank) lo = mid + 1;
      else hi = mid;
    }
    hits.splice(lo, 0, { person, rank, field, word });
    if (hits.length > limit) hits.pop();
    // Exact name-prefix matches have the best possible rank. Once their visible
    // slots are full, every remaining entry is guaranteed to rank after them.
    if (hits.length === limit && hits[hits.length - 1].rank === 0) break;
  }
  return hits;
}
