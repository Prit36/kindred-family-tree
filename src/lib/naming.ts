import type { Tree } from '../types';
import { gujaratiKinship } from './gujarati';
import { kinshipFor, relationBetween } from './kinship';

/** Which words relationships are named in. */
export type Naming = 'en' | 'gu' | 'gu-latn';

export const NAMINGS: { value: Naming; label: string; example: string }[] = [
  { value: 'en', label: 'English', example: 'Uncle, Cousin, Sister-in-law' },
  { value: 'gu', label: 'ગુજરાતી', example: 'કાકા, માસી, ભાભી' },
  { value: 'gu-latn', label: 'Gujarati in English letters', example: 'Kaka, Masi, Bhabhi' },
];

export interface RelationName {
  /** As shown in the chosen naming: "કાકા" */
  label: string;
  /** What a Gujarati name means in English, for a tooltip: "Father's younger brother" - or '' */
  meaning: string;
}

/**
 * What the home person is called on their own card: "You" in English, "હું" (I) in
 * Gujarati - Gujarati names are said from the home person's side (કાકા = મારા કાકા),
 * so the card reads as them speaking.
 */
export function selfLabel(naming: Naming): string {
  return naming === 'gu' ? 'હું' : naming === 'gu-latn' ? 'Hu' : 'You';
}

const labelCache = new WeakMap<Tree, Map<Naming, Map<string, string>>>();

/** Everyone's relationship to the tree's home person, in the chosen naming (memoised per tree). */
export function relationLabels(tree: Tree, naming: Naming): Map<string, string> {
  if (naming === 'en') return kinshipFor(tree);
  let perTree = labelCache.get(tree);
  if (!perTree) labelCache.set(tree, (perTree = new Map()));
  let out = perTree.get(naming);
  if (out) return out;
  out = new Map();
  for (const [id, term] of gujaratiKinship(tree, tree.homeId)) out.set(id, naming === 'gu' ? term.gu : term.latin);
  if (tree.homeId) out.set(tree.homeId, selfLabel(naming));
  perTree.set(naming, out);
  return out;
}

/** How `otherId` is related to `fromId`, in the chosen naming, with the other forms alongside. */
export function relationName(tree: Tree, fromId: string, otherId: string, naming: Naming): RelationName | null {
  if (naming === 'en') {
    const label = relationBetween(tree, fromId, otherId);
    return label ? { label, meaning: '' } : null;
  }
  const term = gujaratiKinship(tree, fromId).get(otherId);
  if (!term) return null;
  return { label: naming === 'gu' ? term.gu : term.latin, meaning: term.en };
}

/** Every name for someone's relationship to the home person, so search finds "uncle", "kaka" or "કાકા" alike. */
export function relationSearchText(tree: Tree, id: string): string {
  if (id === tree.homeId) return 'you me હું hu';
  const term = gujaratiKinship(tree, tree.homeId).get(id);
  return [kinshipFor(tree).get(id) ?? '', term?.gu ?? '', term?.latin ?? '', term?.en ?? ''].join(' ').toLowerCase();
}
