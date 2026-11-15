import { LEXICON, NAME_PARTS } from './gujaratiLexicon';

/**
 * People's names in Gujarati script, from names typed in English letters.
 *
 * Everything runs in the browser, offline, from a ~30 KB word list - no model or service:
 *
 * 1. Spellings the family has corrected (kept with the tree, see `learnSpellings`).
 * 2. Names as Gujarati families write them (gujaratiLexicon.ts): ગીતા, પ્રવીણ, હસમુખ.
 * 3. Compounds split into parts listed there: "Kishanlal" → કિશન + લાલ, "Dilipbhai" → દિલીપ + ભાઈ.
 * 4. Whatever is left, by sound, with the rules Gujarati spelling follows (see `bySound`).
 *
 * Initials stay initials, said as letters: "D." → "ડી.".
 */

export type Spellings = Readonly<Record<string, string>>;

const NONE: Spellings = Object.freeze({});
const GUJARATI = /[઀-૿]/;

// ---------------------------------------------------------------------------
// By sound
// ---------------------------------------------------------------------------

const VIRAMA = '્';
const ANUSVARA = 'ં';

/** Consonants, longest spelling first. */
const CONSONANTS: [string, string][] = [
  ['ksh', 'ક્ષ'], ['chh', 'છ'], ['gny', 'જ્ઞ'],
  ['kh', 'ખ'], ['gh', 'ઘ'], ['ch', 'ચ'], ['jh', 'ઝ'], ['th', 'થ'], ['dh', 'ધ'], ['ph', 'ફ'], ['bh', 'ભ'],
  ['sh', 'શ'], ['gn', 'જ્ઞ'],
  ['k', 'ક'], ['q', 'ક'], ['g', 'ગ'], ['c', 'ક'], ['j', 'જ'], ['z', 'ઝ'], ['t', 'ત'], ['d', 'દ'], ['n', 'ન'],
  ['p', 'પ'], ['f', 'ફ'], ['b', 'બ'], ['m', 'મ'], ['y', 'ય'], ['r', 'ર'], ['l', 'લ'], ['v', 'વ'], ['w', 'વ'],
  ['s', 'સ'], ['h', 'હ'], ['x', 'ક્ષ'],
];

/** Vowels: [spelling, as a letter of its own, as a sign on a consonant]. */
const VOWELS: [string, string, string][] = [
  ['aa', 'આ', 'ા'], ['ai', 'ઐ', 'ૈ'], ['au', 'ઔ', 'ૌ'], ['ee', 'ઈ', 'ી'], ['ii', 'ઈ', 'ી'], ['oo', 'ઊ', 'ૂ'],
  ['uu', 'ઊ', 'ૂ'], ['ou', 'ઔ', 'ૌ'],
  ['a', 'અ', ''], ['i', 'ઇ', 'િ'], ['u', 'ઉ', 'ુ'], ['e', 'એ', 'ે'], ['o', 'ઓ', 'ો'],
];

type Unit = { kind: 'c'; key: string; gu: string } | { kind: 'v'; key: string; letter: string; sign: string } | { kind: 'x'; text: string };

function units(word: string): Unit[] {
  // "Sofia", "Riana": the glide Gujarati writes between i and a (સોફિયા).
  const w = word.replace(/([iey])(?=a)/g, (m) => (m === 'y' ? m : `${m}y`)).replace(/yy/g, 'y');
  const out: Unit[] = [];
  let i = 0;
  outer: while (i < w.length) {
    for (const [key, letter, sign] of VOWELS) {
      if (w.startsWith(key, i)) {
        out.push({ kind: 'v', key, letter, sign });
        i += key.length;
        continue outer;
      }
    }
    for (const [key, gu] of CONSONANTS) {
      if (w.startsWith(key, i)) {
        // "gn" is જ્ઞ only before a vowel (Pragnesh); otherwise g + n.
        if (key === 'gn' && !/[aeiou]/.test(w[i + 2] ?? '')) continue;
        // "c" before e or i sounds as s.
        out.push({ kind: 'c', key, gu: key === 'c' && /[eiy]/.test(w[i + 1] ?? '') ? 'સ' : gu });
        i += key.length;
        continue outer;
      }
    }
    out.push({ kind: 'x', text: w[i] });
    i++;
  }
  return out;
}

/** Pairs that are written joined (કલ્પેશ, ભક્તિ) rather than each with its own vowel (હસમુખ, જગદીશ). */
const JOINED = new Set([
  'k t', 'p t', 'l p', 'd m', 't n', 't m', 't s', 'd dh', 't th', 'ch chh', 'g dh', 'b dh', 'h m', 'h n', 't k', 't p',
  'k sh', 'p n', 'sh n', 'sh m', 's n', 's m', 's t', 's th', 's k', 's p', 'sh t', 'sh th', 'sh k', 'sh p', 'sh v', 's v',
]);
const BEFORE_V = new Set(['s', 'sh', 'd', 't', 'j', 'dh', 'k', 'n', 'th']);

function joined(a: string, b: string): boolean {
  if (b === 'y' || b === 'r' || a === 'r' || a === b) return true;
  if (b === 'v') return BEFORE_V.has(a);
  // Sapna, Kamlesh, Jagdish keep their letters whole; these are written joined.
  if (a === 'p' && b === 'n') return false;
  return JOINED.has(`${a} ${b}`);
}

/** Consonants that take ૃ for "ru" (કૃપા, તૃપ્તિ, સૃષ્ટિ) - but ધ્રુવ, દ્રુપદ, શ્રુતિ keep ્રુ. */
const VOCALIC_R = new Set(['k', 'kh', 'g', 'gh', 't', 'th', 'p', 'ph', 'b', 'bh', 'm', 'n', 'h', 'v', 's']);
const NASAL_KEEP = new Set(['y', 'v', 'r', 'h', 'n', 'm']);
const LABIAL = new Set(['p', 'ph', 'b', 'bh', 'f']);

const isConsonant = (u: Unit | undefined, key: string) => u?.kind === 'c' && u.key === key;

/** A name written as it sounds, by the rules Gujarati spelling follows. */
function bySound(word: string): string {
  const u = units(word);
  let out = '';
  for (let i = 0; i < u.length; i++) {
    const cur = u[i];
    const next = u[i + 1];
    const last = i === u.length - 1 || u[i + 1]?.kind === 'x';
    if (cur.kind === 'x') {
      out += cur.text;
      continue;
    }
    if (cur.kind === 'v') {
      // A vowel of its own: at the start, or after another vowel. A final i is long (ભારતી).
      if (cur.key === 'i' && last) out += 'ઈ';
      else out += cur.letter;
      continue;
    }

    const prev = u[i - 1];
    const afterVowel = !prev || prev.kind !== 'c';

    // n or m before another consonant is the nasal dot on the syllable before: સંજય, ચંપા.
    // Before "dr" it stays a letter (મહેન્દ્ર).
    if (
      next?.kind === 'c' &&
      prev?.kind === 'v' &&
      ((cur.key === 'n' && !NASAL_KEEP.has(next.key)) || (cur.key === 'm' && LABIAL.has(next.key))) &&
      !isConsonant(u[i + 2], 'r')
    ) {
      out += ANUSVARA;
      continue;
    }

    // "sh" before t and th is ષ (ધર્મિષ્ઠા), and before n (કૃષ્ણ).
    let letter = cur.gu;
    if (cur.key === 'sh' && next?.kind === 'c' && (next.key === 't' || next.key === 'th' || next.key === 'n')) {
      letter = 'ષ';
      if (next.key === 'n') u[i + 1] = { ...next, gu: 'ણ' };
      if (next.key === 't') u[i + 1] = { ...next, gu: 'ટ' };
      if (next.key === 'th') u[i + 1] = { ...next, gu: 'ઠ' };
    }

    // Consonant + "ru" at the start of a cluster: ૃ.
    const r = u[i + 1];
    const ru = u[i + 2];
    if (afterVowel && VOCALIC_R.has(cur.key) && r?.kind === 'c' && r.key === 'r' && ru?.kind === 'v' && ru.key === 'u') {
      out += letter + 'ૃ';
      i += 2;
      continue;
    }

    if (next?.kind === 'v') {
      const end = i + 1 === u.length - 1 || u[i + 2]?.kind === 'x';
      // A name's final a is long (ગીતા, રેખા), as are a final i and ee (ભારતી).
      const sign = end && next.key === 'a' ? 'ા' : end && next.key === 'i' ? 'ી' : next.sign;
      out += letter + sign;
      i++;
      continue;
    }
    if (next?.kind === 'c') {
      // Final y after a doubled letter is an English -y (Sunny): ી.
      if (next.key === 'y' && i + 1 === u.length - 1 && isConsonant(u[i - 1], cur.key)) {
        out += letter + 'ી';
        i++;
        continue;
      }
      out += joined(cur.key, next.key) ? letter + VIRAMA : letter;
      continue;
    }
    // At the end of a word a consonant keeps its letter whole (ભરત, not ભરત્).
    out += letter;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const VOWEL_LETTERS: Record<string, string> = {
  'અ': '', 'આ': 'ા', 'ઇ': 'િ', 'ઈ': 'ી', 'ઉ': 'ુ', 'ઊ': 'ૂ', 'એ': 'ે', 'ઐ': 'ૈ', 'ઓ': 'ો', 'ઔ': 'ૌ', 'ઋ': 'ૃ',
};
const CONSONANT = /[ક-હ]$/;

/** Joins two pieces of a name: દિન + એશ is દિનેશ, ભા + ઈ stays ભાઈ. */
function join(a: string, b: string): string {
  if (!a) return b;
  const sign = VOWEL_LETTERS[b[0]];
  if (sign !== undefined && CONSONANT.test(a)) return a + sign + b.slice(1);
  return a + b;
}

/** Letters as said in Gujarati, for initials: "D." → "ડી.". */
const LETTERS: Record<string, string> = {
  a: 'એ', b: 'બી', c: 'સી', d: 'ડી', e: 'ઈ', f: 'એફ', g: 'જી', h: 'એચ', i: 'આઈ', j: 'જે', k: 'કે', l: 'એલ', m: 'એમ',
  n: 'એન', o: 'ઓ', p: 'પી', q: 'ક્યૂ', r: 'આર', s: 'એસ', t: 'ટી', u: 'યુ', v: 'વી', w: 'ડબલ્યુ', x: 'એક્સ', y: 'વાય', z: 'ઝેડ',
};

/**
 * The cheapest reading of a word as listed names, name parts and stretches spelled by
 * sound. A listed piece costs 1 (a name part only ½); a stretch by sound costs more the
 * longer it is, so "Kishanlal" reads as કિશન + લાલ but "Manali" isn't forced into મન + અલી.
 */
function compose(word: string, spellings: Spellings): string {
  const n = word.length;
  const listed = (piece: string, start: number): string | undefined => {
    const own = spellings[piece];
    if (own) return own;
    if (start === 0 && piece.length === n) return LEXICON.get(piece);
    // Names inside a compound need a few letters to be trusted.
    return piece.length >= 3 ? LEXICON.get(piece) : undefined;
  };
  // Best reading of word[i..], right to left. Longer pieces are tried first and win ties.
  const best: { cost: number; end: number; gu: string | undefined }[] = new Array(n + 1);
  best[n] = { cost: 0, end: n, gu: '' };
  for (let i = n - 1; i >= 0; i--) {
    let choice: (typeof best)[number] = { cost: Infinity, end: n, gu: undefined };
    for (let j = n; j > i; j--) {
      const piece = word.slice(i, j);
      const part = i > 0 && !spellings[piece] ? NAME_PARTS.get(piece) : undefined;
      const gu = part ?? listed(piece, i);
      // A stretch spelled by sound needs a vowel of its own: "Krupesh" isn't ક + રૂપેશ.
      if (!gu && !/[aeiou]/.test(piece) && j - i < n) continue;
      // -bhai, -lal and the like are cheapest, so a name spelled by sound still ends where they begin.
      const cost = best[j].cost + (part ? 0.5 : gu ? 1 : 1 + 0.25 * piece.length);
      if (cost < choice.cost - 1e-9) choice = { cost, end: j, gu };
    }
    best[i] = choice;
  }
  let out = '';
  for (let i = 0; i < n; i = best[i].end) out = join(out, best[i].gu ?? bySound(word.slice(i, best[i].end)));
  return out;
}

const cache = new WeakMap<Spellings, Map<string, string>>();

/** One word of a name in Gujarati: "Dilipbhai" → દિલીપભાઈ, "D." → ડી. */
function word(token: string, spellings: Spellings): string {
  if (GUJARATI.test(token)) return token;
  let perList = cache.get(spellings);
  if (!perList) cache.set(spellings, (perList = new Map()));
  const hit = perList.get(token);
  if (hit !== undefined) return hit;

  let out: string;
  const lower = token.toLowerCase();
  const initial = /^([a-z])\.?$/.exec(lower);
  if (initial) {
    out = LETTERS[initial[1]] + (lower.endsWith('.') ? '.' : '');
  } else {
    // Keep punctuation around a name (brackets, a trailing comma) as it is.
    const m = /^([^a-z]*)([a-z][a-z'-]*?)([^a-z]*)$/.exec(lower);
    if (!m) out = token;
    else {
      const [, before, core, after] = m;
      out = before + core.split('-').map((part) => (part ? compose(part.replace(/'/g, ''), spellings) : '')).join('-') + after;
    }
  }
  perList.set(token, out);
  return out;
}

/** A name (or several words of one) in Gujarati script. */
export function toGujarati(text: string, spellings: Spellings = NONE): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const whole = spellings[trimmed.toLowerCase().replace(/\s+/g, ' ')];
  if (whole) return whole;
  return trimmed
    .split(/(\s+)/)
    .map((t) => (/^\s+$/.test(t) ? ' ' : word(t, spellings)))
    .join('');
}

// ---------------------------------------------------------------------------
// Learning from corrections
// ---------------------------------------------------------------------------

/** Suffixes that are learned apart from the name they're on, so a fix to "Kunvarjibhai" also fixes "Kunvarji". */
const SUFFIXES: [string, string][] = [
  ['bhai', 'ભાઈ'], ['ben', 'બેન'], ['bahen', 'બહેન'], ['behen', 'બહેન'], ['kumari', 'કુમારી'], ['kumar', 'કુમાર'],
];

/**
 * The tree's own spellings after someone writes `latin` as `gujarati` by hand. Each word
 * that differs from what would be worked out is remembered, so every other person with
 * that name is spelled the same way; a word written as it would have been anyway is
 * forgotten. When the words don't line up one for one, the whole name is remembered.
 * Returns the same object when nothing changes.
 */
export function learnSpellings(spellings: Spellings, latin: string, gujarati: string): Spellings {
  const l = latin.trim().split(/\s+/).filter(Boolean);
  const g = gujarati.trim().split(/\s+/).filter(Boolean);
  if (!l.length) return spellings;
  const next: Record<string, string> = { ...spellings };
  const wholeKey = l.join(' ').toLowerCase();
  const set = (key: string, value: string, automatic: string) => {
    if (value === automatic) delete next[key];
    else next[key] = value;
  };

  // A whole-name spelling from before no longer applies once the words are given one by one.
  delete next[wholeKey];
  const isInitial = (t: string) => /^[a-z]\.?$/i.test(t);
  if (!g.length) {
    // Cleared: back to the automatic spelling for these words.
    for (const t of l) delete next[t.toLowerCase()];
  } else if (l.length !== g.length || l.some((t, i) => isInitial(t) && word(t, NONE) !== g[i])) {
    set(wholeKey, g.join(' '), toGujarati(l.join(' ')));
  } else {
    l.forEach((t, i) => {
      if (isInitial(t)) return;
      let key = t.toLowerCase();
      let value = g[i];
      for (const [suffix, gu] of SUFFIXES) {
        if (key.length > suffix.length && key.endsWith(suffix) && value.length > gu.length && value.endsWith(gu)) {
          key = key.slice(0, -suffix.length);
          value = value.slice(0, -gu.length);
          delete next[t.toLowerCase()];
          break;
        }
      }
      set(key, value, compose(key, NONE));
    });
  }

  const keys = Object.keys(next);
  if (keys.length === Object.keys(spellings).length && keys.every((k) => spellings[k] === next[k])) return spellings;
  return next;
}

// ---------------------------------------------------------------------------
// Which script names are shown in
// ---------------------------------------------------------------------------

interface NameScript {
  gujarati: boolean;
  spellings: Spellings;
}

let source: () => NameScript = () => ({ gujarati: false, spellings: NONE });

/** Tells this module where the app keeps the chosen script and the tree's spellings (set once, by the store). */
export function setNameScriptSource(read: () => NameScript) {
  source = read;
}

/** Whether names are currently shown in Gujarati, and the tree's own spellings. */
export function nameScript(): NameScript {
  return source();
}

/** The first letter of a Gujarati word, for initials on an avatar: ભરત → ભ. */
export function firstLetter(gu: string): string {
  const m = /[અ-હ]/.exec(gu);
  return m ? m[0] : '';
}

export { NONE as NO_SPELLINGS };
