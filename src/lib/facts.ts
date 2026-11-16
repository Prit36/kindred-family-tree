/**
 * Facts kept in a person's notes as "key: value" lines - the way a community directory
 * import writes them ("blood_group: O+", "education: STD-12"). Pulled out so they can be
 * shown as stamps and counted across the family, instead of read as a pasted note.
 */
export interface Facts {
  blood: string;
  education: string;
  occupation: string;
  memberNo: string;
  /** Lines about where the record came from, and facts the tree itself already states */
  source: string;
  /** Whatever else the note says, as written */
  rest: string;
}

const KEYS: [RegExp, keyof Pick<Facts, 'blood' | 'education' | 'occupation' | 'memberNo'>][] = [
  [/^blood[_ ]?(?:group|type)?$/i, 'blood'],
  [/^(?:education|qualification|studies)$/i, 'education'],
  [/^(?:current[_ ]activity|occupation|profession|work)$/i, 'occupation'],
  [/^member[_ ]?(?:no|number|id)\.?$/i, 'memberNo'],
];

/** Written by an importer, not by the family: kept, but out of the way. */
const SOURCE_LINE = /^(?:source|original name|marital[_ ]status)\s*:|^directory attributes are recorded/i;
const BLANK_VALUE = /^\(?\s*(?:not recorded|unknown|n\/?a|none|-+)\s*\)?$/i;

const cache = new Map<string, Facts>();
const NONE: Facts = { blood: '', education: '', occupation: '', memberNo: '', source: '', rest: '' };

export function factsOf(notes: string): Facts {
  if (!notes) return NONE;
  const hit = cache.get(notes);
  if (hit) return hit;

  const facts: Facts = { ...NONE };
  const source: string[] = [];
  const rest: string[] = [];
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([A-Za-z][A-Za-z_ ]{1,24}?)\s*:\s*(.*)$/.exec(line);
    const key = m && KEYS.find(([re]) => re.test(m[1]));
    if (m && key) {
      const value = m[2].trim();
      if (value && !BLANK_VALUE.test(value) && !facts[key[1]]) facts[key[1]] = value;
      continue;
    }
    (SOURCE_LINE.test(line) ? source : rest).push(line);
  }
  facts.blood = facts.blood.toUpperCase().replace(/\s+/g, '').replace(/POSITIVE|\+VE/, '+').replace(/NEGATIVE|-VE/, '-');
  facts.education = tidyEducation(facts.education);
  facts.occupation = tidyOccupation(facts.occupation);
  facts.source = source.join('\n');
  facts.rest = rest.join('\n');

  if (cache.size > 6000) cache.clear();
  cache.set(notes, facts);
  return facts;
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
