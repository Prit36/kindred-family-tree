import { shapeOf, type Shape } from './shape';
import type { Gender, Tree, UnionStatus } from '../types';
import { indexOf, partnerIn, unionsOf } from './tree';
import { LruMap } from './lru';

/**
 * Gujarati relationship names (સંબંધ), worked out from the chain of people linking two
 * relatives.
 *
 * Gujarati has a word for almost every link English lumps together: a father's elder
 * brother (મોટા બાપુ) is not his younger brother (કાકા), a mother's brother (મામા) is not her
 * sister's husband (માસા), a husband's elder brother (જેઠ) is not his younger one (દિયર),
 * and your child's parents-in-law are your વેવાઈ / વેવાણ. So rather than the English
 * engine's "how many generations up and down", this follows the actual path - father,
 * then his younger brother, then his son - and names it piece by piece, using the
 * longest stretches that have a word of their own and joining the rest with the genitive
 * ("કાકાનો દીકરો", Kaka's son). Elder and younger come from birth dates; where they are
 * unknown the general word is used (કાકા, ભાઈ) or both are offered (જેઠ/દિયર).
 */

export interface GuTerm {
  /** In Gujarati script: "કાકાનો દીકરો" */
  gu: string;
  /** In Latin letters: "Kaka no dikro" */
  latin: string;
  /** What it means in English: "Father's younger brother's son" */
  en: string;
}

// ---------------------------------------------------------------------------
// The path between two people
// ---------------------------------------------------------------------------

type EdgeKind = 'up' | 'down' | 'spouse';

interface Edge {
  to: string;
  kind: EdgeKind;
  status: UnionStatus | null;
}

/** A link in a relationship chain, after "parent's child" has been folded into "sibling". */
interface Step {
  kind: 'up' | 'down' | 'sib' | 'spouse';
  /** The person this step arrives at */
  id: string;
  g: Gender;
  /** For siblings: elder or younger than the person whose sibling they are, if known */
  age: 'e' | 'y' | null;
  /** For siblings: sharing only one parent */
  half: boolean;
  status: UnionStatus | null;
  /** Generations above the person the chain starts from (parents +1, children −1) */
  gen: number;
}

// Marriages cost far more than blood links, so a blood relationship always wins and
// among in-law routes the one through fewest marriages is used - as the English labels do.
const MARRIAGE = 1000;
const costOf = (e: Edge) => (e.kind === 'spouse' ? (e.status === 'divorced' ? 2 * MARRIAGE : MARRIAGE) + 1 : 1);

/** Small binary heap of [cost, key]. */
class Heap {
  private items: [number, string][] = [];
  get size() {
    return this.items.length;
  }
  push(item: [number, string]) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, string] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * The cheapest chain of links from `egoId` to everyone they're connected to. Going down
 * to a child and straight back up to that child's other parent is never allowed: that
 * other parent is a partner, reached directly.
 */
function* shortestPaths(tree: Tree, egoId: string): Generator<[string, Edge[]]> {
  const { children } = indexOf(tree);
  // State key: person id + whether we arrived by going down to them.
  const dist = new Map<string, number>();
  const prev = new Map<string, { key: string; edge: Edge } | null>();
  const start = `${egoId}|0`;
  dist.set(start, 0);
  prev.set(start, null);
  const heap = new Heap();
  heap.push([0, start]);

  while (heap.size) {
    const [d, key] = heap.pop();
    if (d !== dist.get(key)) continue;
    const bar = key.lastIndexOf('|');
    const id = key.slice(0, bar);
    const cameDown = key.slice(bar + 1) === '1';
    const person = tree.people[id];
    if (!person) continue;

    const edges: Edge[] = [];
    if (!cameDown) for (const pid of person.parentIds) edges.push({ to: pid, kind: 'up', status: null });
    for (const cid of children.get(id) ?? []) edges.push({ to: cid, kind: 'down', status: null });
    for (const u of unionsOf(tree, id)) edges.push({ to: partnerIn(u, id), kind: 'spouse', status: u.status });

    for (const edge of edges) {
      if (!tree.people[edge.to]) continue;
      const nextKey = `${edge.to}|${edge.kind === 'down' ? 1 : 0}`;
      const nd = d + costOf(edge);
      if (nd < (dist.get(nextKey) ?? Infinity)) {
        dist.set(nextKey, nd);
        prev.set(nextKey, { key, edge });
        heap.push([nd, nextKey]);
      }
    }
  }

  for (const id of Object.keys(tree.people)) {
    const a = dist.get(`${id}|0`) ?? Infinity;
    const b = dist.get(`${id}|1`) ?? Infinity;
    if (a === Infinity && b === Infinity) continue;
    let key: string | undefined = a <= b ? `${id}|0` : `${id}|1`;
    const path: Edge[] = [];
    for (let link = prev.get(key); link; link = prev.get(key)) {
      path.push(link.edge);
      key = link.key;
    }
    yield [id, path.reverse()];
  }
}

/** -1 when `a` was born before `b`, 1 when after, 0 when that can't be told. */
function birthOrder(tree: Tree, a: string, b: string): -1 | 0 | 1 {
  const da = tree.people[a]?.birthDate ?? '';
  const db = tree.people[b]?.birthDate ?? '';
  // Partial ISO dates compare as strings, unless one is just a less precise form of the other.
  if (!da || !db || da.startsWith(db) || db.startsWith(da)) return 0;
  return da < db ? -1 : 1;
}

function isHalf(tree: Tree, a: string, b: string): boolean {
  const pa = tree.people[a]?.parentIds ?? [];
  const pb = tree.people[b]?.parentIds ?? [];
  if (pa.length < 2 || pb.length < 2) return false;
  return pa.filter((x) => pb.includes(x)).length === 1;
}

function toSteps(tree: Tree, egoId: string, edges: Edge[]): Step[] {
  const nodes = [egoId, ...edges.map((e) => e.to)];
  const steps: Step[] = [];
  let gen = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (e.kind === 'up' && edges[i + 1]?.kind === 'down') {
      // Up to a parent and down to another of their children: a sibling.
      const of = nodes[i];
      const to = nodes[i + 2];
      const order = birthOrder(tree, to, of);
      steps.push({
        kind: 'sib',
        id: to,
        g: tree.people[to].gender,
        age: order === -1 ? 'e' : order === 1 ? 'y' : null,
        half: isHalf(tree, of, to),
        status: null,
        gen,
      });
      i++;
      continue;
    }
    gen += e.kind === 'up' ? 1 : e.kind === 'down' ? -1 : 0;
    steps.push({ kind: e.kind, id: e.to, g: tree.people[e.to].gender, age: null, half: false, status: e.status, gen });
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

interface Word {
  gu: string;
  latin: string;
  en: string;
  /** Spoken of with respect (genitive ના rather than નો) even when not older */
  honour?: boolean;
}

/**
 * Stretches of a chain that have a name of their own. Each pattern is a space-separated
 * list of links:
 *
 * - parent `F` father, `M` mother, `P` parent of unrecorded gender, `^` any parent
 * - child `S` son, `D` daughter, `C` child, `v` any child
 * - sibling `B` brother, `Z` sister, `X` sibling, `~` any sibling; `eB` elder brother,
 *   `yZ` younger sister… (`B` alone matches whatever the age)
 * - partner `H` husband, `W` wife, `Sp` spouse, `&` any - never an ex
 *
 * Where two patterns cover the same links, the one listed first wins, so the elder /
 * younger forms come before the general one.
 */
const PATTERNS: [pattern: string, gu: string, latin: string, en: string, honour?: boolean][] = [
  // Grandparents
  ['F F', 'દાદા', 'Dada', 'Paternal grandfather'],
  ['F M', 'દાદી', 'Dadi', 'Paternal grandmother'],
  ['M F', 'નાના', 'Nana', 'Maternal grandfather'],
  ['M M', 'નાની', 'Nani', 'Maternal grandmother'],
  ['P F', 'દાદા/નાના', 'Dada/Nana', 'Grandfather'],
  ['P M', 'દાદી/નાની', 'Dadi/Nani', 'Grandmother'],
  ['F ^ F', 'પરદાદા', 'Pardada', 'Paternal great-grandfather'],
  ['F ^ M', 'પરદાદી', 'Pardadi', 'Paternal great-grandmother'],
  ['M ^ F', 'પરનાના', 'Parnana', 'Maternal great-grandfather'],
  ['M ^ M', 'પરનાની', 'Parnani', 'Maternal great-grandmother'],
  // Grandparents' brothers and sisters are called by the grandparent's own word
  ['F F B', 'દાદા', 'Dada', "Paternal grandfather's brother"],
  ['F F B W', 'દાદી', 'Dadi', "Paternal grandfather's brother's wife"],
  ['M F B', 'નાના', 'Nana', "Maternal grandfather's brother"],
  ['M F B W', 'નાની', 'Nani', "Maternal grandfather's brother's wife"],
  ['M M Z', 'નાની', 'Nani', "Maternal grandmother's sister"],

  // Father's side
  ['F eB', 'મોટા બાપુ', 'Mota Bapu', "Father's elder brother"],
  ['F yB', 'કાકા', 'Kaka', "Father's younger brother"],
  ['F B', 'કાકા', 'Kaka', "Father's brother"],
  ['F eB W', 'મોટી બા', 'Moti Ba', "Father's elder brother's wife"],
  ['F B W', 'કાકી', 'Kaki', "Father's brother's wife"],
  ['F Z', 'ફોઈ', 'Foi', "Father's sister"],
  ['F Z H', 'ફુઆ', 'Fua', "Father's sister's husband"],
  // Mother's side
  ['M B', 'મામા', 'Mama', "Mother's brother"],
  ['M B W', 'મામી', 'Mami', "Mother's brother's wife"],
  ['M Z', 'માસી', 'Masi', "Mother's sister"],
  ['M Z H', 'માસા', 'Masa', "Mother's sister's husband"],
  // A parent's cousins are called as the parent's own brothers and sisters are
  ['F ^ ~ S', 'કાકા', 'Kaka', "Father's cousin"],
  ['F ^ ~ S W', 'કાકી', 'Kaki', "Father's cousin's wife"],
  ['F ^ ~ D', 'ફોઈ', 'Foi', "Father's cousin (female)"],
  ['F ^ ~ D H', 'ફુઆ', 'Fua', "Father's female cousin's husband"],
  ['M ^ ~ S', 'મામા', 'Mama', "Mother's cousin"],
  ['M ^ ~ S W', 'મામી', 'Mami', "Mother's cousin's wife"],
  ['M ^ ~ D', 'માસી', 'Masi', "Mother's cousin (female)"],
  ['M ^ ~ D H', 'માસા', 'Masa', "Mother's female cousin's husband"],
  // Cousins' partners are bhabhi and banevi, like a brother's or sister's
  ['^ ~ S W', 'ભાભી', 'Bhabhi', "Cousin's wife"],
  ['^ ~ D H', 'બનેવી', 'Banevi', "Cousin's husband", true],

  // Step-parents
  ['F W', 'ઓરમાન મા', 'Orman ma', 'Stepmother'],
  ['M H', 'ઓરમાન પિતા', 'Orman pita', 'Stepfather'],
  ['^ &', 'ઓરમાન માતા/પિતા', 'Orman mata/pita', 'Step-parent'],

  // Brothers' and sisters' families
  ['B W', 'ભાભી', 'Bhabhi', "Brother's wife"],
  ['Z H', 'બનેવી', 'Banevi', "Sister's husband", true],
  ['B S', 'ભત્રીજો', 'Bhatrijo', "Brother's son"],
  ['B D', 'ભત્રીજી', 'Bhatriji', "Brother's daughter"],
  ['Z S', 'ભાણેજ', 'Bhanej', "Sister's son"],
  ['Z D', 'ભાણી', 'Bhani', "Sister's daughter"],

  // Children's families
  ['S W', 'વહુ', 'Vahu', "Son's wife"],
  ['D H', 'જમાઈ', 'Jamai', "Daughter's husband", true],
  ['S S S', 'પ્રપૌત્ર', 'Prapautra', 'Great-grandson'],
  ['S S D', 'પ્રપૌત્રી', 'Prapautri', 'Great-granddaughter'],
  ['S S', 'પૌત્ર', 'Pautra', "Son's son"],
  ['S D', 'પૌત્રી', 'Pautri', "Son's daughter"],
  ['D S', 'દોહિત્ર', 'Dohitra', "Daughter's son"],
  ['D D', 'દોહિત્રી', 'Dohitri', "Daughter's daughter"],
  ['S W F', 'વેવાઈ', 'Vevai', "Son's father-in-law", true],
  ['S W M', 'વેવાણ', 'Vevan', "Son's mother-in-law"],
  ['D H F', 'વેવાઈ', 'Vevai', "Daughter's father-in-law", true],
  ['D H M', 'વેવાણ', 'Vevan', "Daughter's mother-in-law"],

  // Partner's family
  ['& F', 'સસરા', 'Sasra', 'Father-in-law', true],
  ['& M', 'સાસુ', 'Sasu', 'Mother-in-law'],
  ['& S', 'ઓરમાન દીકરો', 'Orman dikro', 'Stepson'],
  ['& D', 'ઓરમાન દીકરી', 'Orman dikri', 'Stepdaughter'],
  ['& v', 'ઓરમાન સંતાન', 'Orman santan', 'Stepchild'],
  ['W B', 'સાળો', 'Salo', "Wife's brother"],
  ['W B W', 'સાળાવેલી', 'Salaveli', "Wife's brother's wife"],
  ['W eZ', 'પાટલા સાસુ', 'Patla Sasu', "Wife's elder sister"],
  ['W Z', 'સાળી', 'Sali', "Wife's sister"],
  ['W Z H', 'સાઢુભાઈ', 'Sadhubhai', "Wife's sister's husband", true],
  ['H eB', 'જેઠ', 'Jeth', "Husband's elder brother", true],
  ['H yB', 'દિયર', 'Diyar', "Husband's younger brother"],
  ['H B', 'જેઠ/દિયર', 'Jeth/Diyar', "Husband's brother", true],
  ['H eB W', 'જેઠાણી', 'Jethani', "Husband's elder brother's wife"],
  ['H yB W', 'દેરાણી', 'Derani', "Husband's younger brother's wife"],
  ['H B W', 'જેઠાણી/દેરાણી', 'Jethani/Derani', "Husband's brother's wife"],
  ['H Z', 'નણંદ', 'Nanand', "Husband's sister"],
  ['H Z H', 'નણદોઈ', 'Nanadoi', "Husband's sister's husband", true],
  ['H B S', 'ભત્રીજો', 'Bhatrijo', "Husband's brother's son"],
  ['H B D', 'ભત્રીજી', 'Bhatriji', "Husband's brother's daughter"],
  ['H Z S', 'ભાણેજ', 'Bhanej', "Husband's sister's son"],
  ['H Z D', 'ભાણી', 'Bhani', "Husband's sister's daughter"],
];

type Matcher = (s: Step) => boolean;

function matcher(token: string): Matcher {
  const age = token.length === 2 && (token[0] === 'e' || token[0] === 'y') ? token[0] : null;
  const t = age ? token.slice(1) : token;
  const g = (want: Gender) => (s: Step) => s.g === want;
  const live = (s: Step) => s.kind === 'spouse' && s.status !== 'divorced';
  switch (t) {
    case 'F':
    case 'M':
    case 'P':
      return (s) => s.kind === 'up' && g(t === 'F' ? 'male' : t === 'M' ? 'female' : 'other')(s);
    case '^':
      return (s) => s.kind === 'up';
    case 'S':
    case 'D':
    case 'C':
      return (s) => s.kind === 'down' && g(t === 'S' ? 'male' : t === 'D' ? 'female' : 'other')(s);
    case 'v':
      return (s) => s.kind === 'down';
    case 'B':
    case 'Z':
    case 'X':
      return (s) =>
        s.kind === 'sib' && g(t === 'B' ? 'male' : t === 'Z' ? 'female' : 'other')(s) && (!age || s.age === age);
    case '~':
      return (s) => s.kind === 'sib';
    case 'H':
    case 'W':
      return (s) => live(s) && g(t === 'H' ? 'male' : 'female')(s);
    case 'Sp':
      return (s) => live(s) && g('other')(s);
    case '&':
      return live;
  }
  throw new Error(`Unknown kinship token ${token}`);
}

const COMPILED = PATTERNS.map(([pattern, gu, latin, en, honour]) => ({
  match: pattern.split(' ').map(matcher),
  word: { gu, latin, en, honour } as Word,
}))
  // Longest first; the order above is kept among patterns of the same length.
  .map((p, i) => ({ ...p, i }))
  .sort((a, b) => b.match.length - a.match.length || a.i - b.i);

/** The word for a single link. */
function single(s: Step): Word {
  const by = (male: Word, female: Word, other: Word) => (s.g === 'male' ? male : s.g === 'female' ? female : other);
  switch (s.kind) {
    case 'up':
      return by(
        { gu: 'પિતા', latin: 'Pita', en: 'Father' },
        { gu: 'માતા', latin: 'Mata', en: 'Mother' },
        { gu: 'માતા/પિતા', latin: 'Mata/Pita', en: 'Parent' },
      );
    case 'down':
      return by(
        { gu: 'દીકરો', latin: 'Dikro', en: 'Son' },
        { gu: 'દીકરી', latin: 'Dikri', en: 'Daughter' },
        { gu: 'સંતાન', latin: 'Santan', en: 'Child' },
      );
    case 'sib': {
      const w =
        s.g === 'male'
          ? s.age === 'e'
            ? { gu: 'મોટા ભાઈ', latin: 'Mota bhai', en: 'Elder brother', honour: true }
            : s.age === 'y'
              ? { gu: 'નાનો ભાઈ', latin: 'Nano bhai', en: 'Younger brother' }
              : { gu: 'ભાઈ', latin: 'Bhai', en: 'Brother' }
          : s.g === 'female'
            ? s.age === 'e'
              ? { gu: 'મોટી બહેન', latin: 'Moti ben', en: 'Elder sister' }
              : s.age === 'y'
                ? { gu: 'નાની બહેન', latin: 'Nani ben', en: 'Younger sister' }
                : { gu: 'બહેન', latin: 'Ben', en: 'Sister' }
            : { gu: 'ભાઈ/બહેન', latin: 'Bhai/Ben', en: 'Sibling' };
      if (!s.half) return w;
      return {
        ...w,
        gu: `ઓરમાન ${w.gu}`,
        latin: `Orman ${w.latin.toLowerCase()}`,
        en: w.en.replace(/(brother|sister|sibling)/i, (m) => `half-${m.toLowerCase()}`).replace(/^h/, 'H'),
      };
    }
    case 'spouse': {
      if (s.status === 'partner') return { gu: 'જીવનસાથી', latin: 'Jivansathi', en: 'Partner' };
      const w = by(
        { gu: 'પતિ', latin: 'Pati', en: 'Husband', honour: true },
        { gu: 'પત્ની', latin: 'Patni', en: 'Wife' },
        { gu: 'જીવનસાથી', latin: 'Jivansathi', en: 'Spouse' },
      );
      if (s.status !== 'divorced') return w;
      return { gu: `પૂર્વ ${w.gu}`, latin: `Purva ${w.latin.toLowerCase()}`, en: `Ex-${w.en.toLowerCase()}` };
    }
  }
}

// Before ના/નો/ની a word ending in -ો takes -ા: દીકરો → દીકરાનો, નાનો ભાઈ → નાના ભાઈનો.
const obliqueGu = (s: string) => s.replace(/ો(?=\s|$)/g, 'ા');
const obliqueLatin = (s: string) => s.replace(/o(?=\s|$)/g, 'a');

/**
 * Splits a chain into named stretches - as few as possible, longest first. Between two
 * splits with as many pieces, the one that names a partner's relatives as theirs wins:
 * "પતિના કાકા" (husband's kaka) rather than "સસરાના નાના ભાઈ" (father-in-law's younger brother).
 */
function segment(steps: Step[]): { word: Word; end: Step }[] {
  const n = steps.length;
  // A stretch that runs on past a partner (સસરા = partner's father) costs a little extra.
  const cost = (from: number, len: number) =>
    10 + (steps.slice(from, from + len - 1).some((s) => s.kind === 'spouse') ? 1 : 0);
  const best: { cost: number; len: number; word: Word }[] = new Array(n + 1);
  best[n] = { cost: 0, len: 0, word: { gu: '', latin: '', en: '' } };
  for (let i = n - 1; i >= 0; i--) {
    let choice = { cost: best[i + 1].cost + cost(i, 1), len: 1, word: single(steps[i]) };
    for (const p of COMPILED) {
      const len = p.match.length;
      if (len < 2 || i + len > n) continue;
      if (!p.match.every((m, k) => m(steps[i + k]))) continue;
      const c = best[i + len].cost + cost(i, len);
      // On a tie the longer first stretch wins: કાકાનો દીકરો, not પિતાનો ભત્રીજો.
      if (c < choice.cost || (c === choice.cost && len > choice.len)) choice = { cost: c, len, word: p.word };
    }
    best[i] = choice;
  }
  const out: { word: Word; end: Step }[] = [];
  for (let i = 0; i < n; i += best[i].len) out.push({ word: best[i].word, end: steps[i + best[i].len - 1] });
  return out;
}

function describe(steps: Step[]): GuTerm {
  const parts = segment(steps);
  let gu = '';
  let latin = '';
  let en = '';
  // Whether each piece is a man spoken of with respect: an elder, or a word like જમાઈ.
  // He takes ના rather than નો, and his word its respectful form (નાનો ભાઈ → નાના ભાઈ).
  const respected = parts.map(({ word, end }) => end.g === 'male' && (word.honour || end.gen > 0));
  parts.forEach(({ word }, i) => {
    const lower = i > 0;
    let wGu = word.gu;
    let wLatin = lower ? word.latin.toLowerCase() : word.latin;
    const wEn = lower ? word.en.toLowerCase() : word.en;
    if (respected[i] || i < parts.length - 1) {
      wGu = obliqueGu(wGu);
      wLatin = obliqueLatin(wLatin);
    }
    const next = parts[i + 1];
    if (!next) {
      gu += wGu;
      latin += wLatin;
      en += wEn;
      return;
    }
    // The genitive agrees with what follows: ની before a woman, ના before a respected man
    // (or someone of unrecorded gender), નો before any other man.
    const g = next.end.g;
    const [gen, l] = g === 'female' ? ['ની', 'ni'] : g === 'male' && !respected[i + 1] ? ['નો', 'no'] : ['ના', 'na'];
    gu += `${wGu}${gen} `;
    latin += `${wLatin} ${l} `;
    en += `${wEn}'s `;
  });
  return { gu, latin, en };
}

const cache = new WeakMap<Shape, Map<string, Map<string, GuTerm>>>();
const homeCache = new WeakMap<Shape, Map<string, GuTerm>>();

/** Gujarati names for how everyone connected to `egoId` is related to them (memoised per tree). */
export function gujaratiKinship(tree: Tree, egoId: string | null): Map<string, GuTerm> {
  if (!egoId || !tree.people[egoId]) return new Map();
  const shape = shapeOf(tree);
  let perTree = cache.get(shape);
  if (!perTree) cache.set(shape, (perTree = new LruMap(8, (terms) => {
    let chars = 0;
    for (const term of terms.values()) chars += term.gu.length + term.latin.length + term.en.length;
    return chars;
  }, 2_000_000)));
  let out = egoId === tree.homeId ? homeCache.get(shape) : perTree.get(egoId);
  if (out) return out;
  out = new Map();
  for (const [id, edges] of shortestPaths(tree, egoId)) {
    if (id === egoId || edges.length === 0) continue;
    out.set(id, describe(toSteps(tree, egoId, edges)));
  }
  if (egoId === tree.homeId) homeCache.set(shape, out);
  else perTree.set(egoId, out);
  return out;
}
