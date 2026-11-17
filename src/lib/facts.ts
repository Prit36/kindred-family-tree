import type { Person } from '../types';

/**
 * A person's blood group, occupation and education - each a field of its own - tidied for
 * showing as stamps and counting across the family, and their notes split into what the
 * family wrote and lines an importer added about where the record came from.
 */
export interface Facts {
  blood: string;
  education: string;
  occupation: string;
  /** Lines about where the record came from, and facts the tree itself already states */
  source: string;
  /** Whatever else the note says, as written */
  rest: string;
}

type FactFields = Pick<Person, 'bloodGroup' | 'occupation' | 'education'>;

/** "key: value" lines a community directory import writes, and the field each belongs in. */
const KEYS: [RegExp, keyof FactFields][] = [
  [/^blood[_ ]?(?:group|type)?$/i, 'bloodGroup'],
  [/^(?:education|qualification|studies)$/i, 'education'],
  [/^(?:current[_ ]activity|occupation|profession|work)$/i, 'occupation'],
];

/** Written by an importer, not by the family: kept, but out of the way. */
const SOURCE_LINE = /^(?:source|original name|marital[_ ]status|member[_ ]?(?:no|number|id)\.?)\s*:|^directory attributes are recorded/i;
const BLANK_VALUE = /^\(?\s*(?:not recorded|unknown|n\/?a|none|-+)\s*\)?$/i;
const KEY_LINE = /^([A-Za-z][A-Za-z_ ]{1,24}?)\s*:\s*(.*)$/;

/**
 * Moves "blood_group: O+"-style lines out of notes into their fields (fields already
 * filled in win). Returns the fields and the notes without those lines.
 */
export function splitFacts(notes: string, fields: FactFields): FactFields & { notes: string } {
  const out = { ...fields, notes };
  if (!notes || !/:/.test(notes)) return out;
  const kept: string[] = [];
  let moved = false;
  for (const raw of notes.split(/\r?\n/)) {
    const m = KEY_LINE.exec(raw.trim());
    const key = m && KEYS.find(([re]) => re.test(m[1]));
    if (!m || !key) {
      kept.push(raw);
      continue;
    }
    moved = true;
    const value = m[2].trim();
    if (value && !BLANK_VALUE.test(value) && !out[key[1]].trim()) {
      out[key[1]] = key[1] === 'bloodGroup' ? tidyBlood(value) : key[1] === 'occupation' ? tidyOccupation(value) : tidyEducation(value);
    }
  }
  if (moved) out.notes = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

const cache = new Map<string, { source: string; rest: string }>();

function notesOf(notes: string): { source: string; rest: string } {
  if (!notes) return { source: '', rest: '' };
  const hit = cache.get(notes);
  if (hit) return hit;
  const source: string[] = [];
  const rest: string[] = [];
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (line) (SOURCE_LINE.test(line) ? source : rest).push(line);
  }
  const out = { source: source.join('\n'), rest: rest.join('\n') };
  if (cache.size > 6000) cache.clear();
  cache.set(notes, out);
  return out;
}

export function factsOf(p: FactFields & Pick<Person, 'notes'>): Facts {
  return {
    blood: tidyBlood(p.bloodGroup),
    occupation: tidyOccupation(p.occupation),
    education: tidyEducation(p.education),
    ...notesOf(p.notes),
  };
}

/** "b positive", "B +VE" → "B+" */
export function tidyBlood(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '').replace(/POSITIVE|\+VE/, '+').replace(/NEGATIVE|-VE/, '-');
}

/** "DOCTOR MD ANESTHETIST" → "Doctor MD Anesthetist": long shouted words are calmed, short ones (degrees) kept. */
function calm(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (/^[A-Z]{4,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join(' ');
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Common ways the same work is written, brought to one wording so they count together. */
const OCCUPATIONS: [RegExp, string][] = [
  [/^house\s*-?(?:wife|work|hold|maker).*$|^home\s*-?maker$/i, 'Homemaker'],
  [/^stud(?:y|ying|ent)s?$/i, 'Student'],
  [/^(?:job|service|naukri|nokri)$/i, 'Job'],
  [/^retire[d]?(?:ment)?$/i, 'Retired'],
  [/^bus+[ie]n+es+h?$|^dhandho$|^vepar$/i, 'Business'],
  [/^contra[ck]tor$/i, 'Contractor'],
  [/^kadiya\s*kam$/i, 'Kadiyakam'],
];

export function tidyOccupation(value: string): string {
  const v = value.replace(/\s+/g, ' ').trim();
  if (!v) return '';
  for (const [re, label] of OCCUPATIONS) if (re.test(v)) return label;
  return capital(calm(v));
}

export function tidyEducation(value: string): string {
  const v = value.replace(/\s+/g, ' ').trim();
  if (!v) return '';
  const std = /^(?:std|standard|class|dhoran)[\s.-]*(\d{1,2})(?:\s*(?:th|st|nd|rd))?\s*(.*)$/i.exec(v);
  if (std) return `Std ${Number(std[1])}${/running|study|pursuing/i.test(std[2]) ? ', studying' : ''}`;
  return calm(v);
}
