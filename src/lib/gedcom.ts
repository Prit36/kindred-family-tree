import type { Gender, Person, Tree, Union, UnionStatus } from '../types';
import { MONTHS, buildDate, formatDate, parseDate } from './dates';
import { blankInput, displayName, sanitizeTree, uid } from './tree';

/**
 * GEDCOM 5.5.1, the format every genealogy program (Ancestry, FamilySearch, MyHeritage,
 * Gramps…) can read and write.
 *
 * Kindred's model is smaller than GEDCOM's, so importing keeps what fits — names, sex,
 * birth and death, parents, couples — and folds the rest that's worth keeping (occupation,
 * death place, marriage dates, approximate dates) into each person's notes.
 * Photos aren't exported; the JSON backup is the lossless format.
 */

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const GED_MONTHS = MONTHS.map((m) => m.toUpperCase());
/** Long values are split into CONC lines well under the 255-character line limit. */
const CHUNK = 200;

function gedDate(s: string): string {
  const { y, m, d } = parseDate(s);
  if (!y) return '';
  if (!m) return String(y);
  if (!d) return `${GED_MONTHS[m - 1]} ${y}`;
  return `${d} ${GED_MONTHS[m - 1]} ${y}`;
}

/** Keeps a value on one line and escapes '@', which GEDCOM reserves for pointers. */
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/@/g, '@@').trim();

/** A text value, continued over CONT (new line) and CONC (same line) lines as needed. */
function textLines(level: number, tag: string, text: string): string[] {
  const out: string[] = [];
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, i) => {
      let rest = line.replace(/@/g, '@@');
      let first = true;
      do {
        let cut = Math.min(CHUNK, rest.length);
        // Don't split next to a space: some readers trim values.
        while (cut < rest.length && cut > 1 && (rest[cut] === ' ' || rest[cut - 1] === ' ')) cut--;
        const piece = rest.slice(0, cut);
        rest = rest.slice(cut);
        const t = i === 0 && first ? `${level} ${tag}` : `${level + 1} ${first ? 'CONT' : 'CONC'}`;
        out.push(piece ? `${t} ${piece}` : t);
        first = false;
      } while (rest);
    });
  return out;
}

const SEX: Record<Gender, string> = { male: 'M', female: 'F', other: 'U' };

/** Writes the tree as a GEDCOM file. The home person comes first, which most programs treat as the root. */
export function toGedcom(tree: Tree, now = new Date()): string {
  const people = Object.values(tree.people);
  if (tree.homeId && tree.people[tree.homeId]) {
    people.sort((a, b) => (a.id === tree.homeId ? -1 : b.id === tree.homeId ? 1 : 0));
  }
  const xref = new Map(people.map((p, i) => [p.id, `@I${i + 1}@`]));

  // A family per couple, plus one per lone parent of children whose other parent isn't known.
  interface Fam {
    spouses: string[];
    children: string[];
    status: UnionStatus | null;
  }
  const fams = new Map<string, Fam>();
  for (const u of tree.unions) {
    fams.set([u.a, u.b].sort().join('|'), { spouses: [u.a, u.b], children: [], status: u.status });
  }
  for (const p of people) {
    if (p.parentIds.length === 0) continue;
    const key = [...p.parentIds].sort().join('|');
    let fam = fams.get(key);
    if (!fam) fams.set(key, (fam = { spouses: [...p.parentIds], children: [], status: null }));
    fam.children.push(p.id);
  }
  const famList = [...fams.values()].filter((f) => f.spouses.every((id) => tree.people[id]));
  const famsOf = new Map<string, string[]>();
  const famcOf = new Map<string, string>();
  famList.forEach((f, i) => {
    const id = `@F${i + 1}@`;
    for (const s of f.spouses) famsOf.set(s, [...(famsOf.get(s) ?? []), id]);
    for (const c of f.children) famcOf.set(c, id);
  });

  const lines: string[] = [
    '0 HEAD',
    '1 SOUR KINDRED',
    '2 NAME Kindred',
    '2 VERS 1.0.0',
    `1 DATE ${now.getDate()} ${GED_MONTHS[now.getMonth()]} ${now.getFullYear()}`,
    '1 SUBM @U1@',
    '1 GEDC',
    '2 VERS 5.5.1',
    '2 FORM LINEAGE-LINKED',
    '1 CHAR UTF-8',
    `1 _KINDRED_TREE ${clean(tree.name)}`,
    '0 @U1@ SUBM',
    '1 NAME Kindred',
  ];

  const nameLine = (first: string, last: string) =>
    `${clean(first.replace(/\//g, ' '))} /${clean(last.replace(/\//g, ' '))}/`.trim();

  for (const p of people) {
    lines.push(`0 ${xref.get(p.id)} INDI`);
    lines.push(`1 NAME ${nameLine(p.firstName, p.lastName)}`);
    if (p.firstName.trim()) lines.push(`2 GIVN ${clean(p.firstName)}`);
    if (p.lastName.trim()) lines.push(`2 SURN ${clean(p.lastName)}`);
    if (p.birthName.trim() && p.birthName.trim() !== p.lastName.trim()) {
      lines.push(`1 NAME ${nameLine(p.firstName, p.birthName)}`, '2 TYPE birth', `2 SURN ${clean(p.birthName)}`);
    }
    lines.push(`1 SEX ${SEX[p.gender]}`);
    if (p.birthDate || p.birthPlace.trim()) {
      lines.push('1 BIRT');
      if (p.birthDate) lines.push(`2 DATE ${gedDate(p.birthDate)}`);
      if (p.birthPlace.trim()) lines.push(`2 PLAC ${clean(p.birthPlace)}`);
    }
    if (p.deathDate) lines.push('1 DEAT', `2 DATE ${gedDate(p.deathDate)}`);
    else if (p.deceased) lines.push('1 DEAT Y');
    if (p.notes.trim()) lines.push(...textLines(1, 'NOTE', p.notes.trim()));
    const famc = famcOf.get(p.id);
    if (famc) lines.push(`1 FAMC ${famc}`);
    for (const f of famsOf.get(p.id) ?? []) lines.push(`1 FAMS ${f}`);
  }

  famList.forEach((f, i) => {
    lines.push(`0 @F${i + 1}@ FAM`);
    // GEDCOM 5.5.1 names the slots HUSB and WIFE. Women go in WIFE where possible.
    const female = (id: string | undefined) => Boolean(id && tree.people[id].gender === 'female');
    let [h, w]: (string | undefined)[] = f.spouses;
    if (f.spouses.length === 1 && female(h)) [h, w] = [undefined, h];
    else if (female(h) && !female(w)) [h, w] = [w, h];
    if (h) lines.push(`1 HUSB ${xref.get(h)}`);
    if (w) lines.push(`1 WIFE ${xref.get(w)}`);
    if (f.status === 'married' || f.status === 'divorced') lines.push('1 MARR Y');
    if (f.status === 'divorced') lines.push('1 DIV Y');
    if (f.status === 'partner') lines.push('1 _KINDRED_STATUS partner');
    for (const c of f.children) lines.push(`1 CHIL ${xref.get(c)}`);
  });

  lines.push('0 TRLR');
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

interface Node {
  tag: string;
  xref: string;
  value: string;
  children: Node[];
}

const LINE = /^\s*(\d{1,2})\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?: (.*))?$/;

/** Splits the file into records (level-0 lines with everything nested under them). */
function parseRecords(text: string): Node[] {
  const records: Node[] = [];
  const stack: Node[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const level = Number(m[1]);
    const node: Node = { tag: m[3].toUpperCase(), xref: m[2] ?? '', value: m[4] ?? '', children: [] };
    if (level === 0) {
      records.push(node);
      stack.length = 0;
      stack.push(node);
      continue;
    }
    // A line nested deeper than its parent allows is attached to the nearest valid one.
    stack.length = Math.min(stack.length, level);
    const parent = stack[stack.length - 1];
    if (!parent) continue;
    parent.children.push(node);
    stack.push(node);
  }
  return records;
}

const child = (n: Node | undefined, tag: string) => n?.children.find((c) => c.tag === tag);
const childrenOf = (n: Node, tag: string) => n.children.filter((c) => c.tag === tag);
const unescape = (s: string) => s.replace(/@@/g, '@');

/** A value with its CONC/CONT continuation lines put back together. */
function fullText(n: Node): string {
  let out = n.value;
  for (const c of n.children) {
    if (c.tag === 'CONC') out += c.value;
    else if (c.tag === 'CONT') out += '\n' + c.value;
  }
  return unescape(out).trim();
}

const MONTH_INDEX: Record<string, number> = Object.fromEntries(GED_MONTHS.map((m, i) => [m, i + 1]));

/**
 * Reads a GEDCOM date into Kindred's partial ISO form. `exact` is false when the source
 * said more than that can hold ("ABT 1850", "BET 1850 AND 1860", "(spring 1850)"…),
 * so the original wording can be kept in the notes.
 */
export function readDate(raw: string): { date: string; exact: boolean } {
  const s = raw.trim().toUpperCase();
  if (!s) return { date: '', exact: true };
  const m = new RegExp(`^(?:@#DGREGORIAN@\\s+)?(?:(\\d{1,2})\\s+)?(?:(${GED_MONTHS.join('|')})\\s+)?(\\d{3,4})(?:/\\d{1,2})?$`).exec(s);
  if (m) {
    const month = m[2] ? MONTH_INDEX[m[2]] : null;
    const date = buildDate({ y: Number(m[3]), m: month, d: m[1] && month ? Number(m[1]) : null });
    return { date, exact: Boolean(date) && (!m[1] || date.length === 10) };
  }
  // Approximate or ranged: keep the first date mentioned.
  const inner = /(?:(\d{1,2})\s+)?(?:(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+)?(\d{3,4})/.exec(s);
  if (!inner) return { date: '', exact: false };
  const month = inner[2] ? MONTH_INDEX[inner[2]] : null;
  return { date: buildDate({ y: Number(inner[3]), m: month, d: inner[1] && month ? Number(inner[1]) : null }), exact: false };
}

/** "John /Smith/ Jr." → given "John", surname "Smith Jr.". GIVN/SURN lines win when present. */
function readName(n: Node): { given: string; surname: string } {
  const value = unescape(n.value);
  const m = /^([^/]*)\/([^/]*)\/?(.*)$/.exec(value);
  let given = m ? m[1] : value;
  let surname = m ? [m[2], m[3]].map((s) => s.trim()).filter(Boolean).join(' ') : '';
  const givn = child(n, 'GIVN');
  const surn = child(n, 'SURN');
  if (givn?.value.trim()) given = unescape(givn.value);
  if (surn?.value.trim() && !surname) surname = unescape(surn.value);
  const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
  return { given: tidy(given), surname: tidy(surname) };
}

const place = (event: Node | undefined) => (child(event, 'PLAC') ? fullText(child(event, 'PLAC')!) : '');

export interface GedcomResult {
  tree: Tree;
  /** People in the file. */
  count: number;
}

/** Builds a tree from GEDCOM text. Throws if there's nobody in it. */
export function parseGedcom(text: string, fallbackName = 'My Family', now = new Date()): GedcomResult {
  const records = parseRecords(text.replace(/^﻿/, ''));
  if (records[0]?.tag !== 'HEAD') throw new Error('Not a GEDCOM file');
  const byXref = new Map(records.filter((r) => r.xref).map((r) => [r.xref, r]));
  const indis = records.filter((r) => r.tag === 'INDI' && r.xref);
  if (indis.length === 0) throw new Error('No people in this file');

  const noteText = (n: Node) => {
    const target = /^@[^@]+@$/.test(n.value.trim()) ? byXref.get(n.value.trim()) : undefined;
    return target ? fullText(target) : fullText(n);
  };

  const ids = new Map<string, string>();
  const people: Record<string, Person> = {};
  const extra = new Map<string, string[]>();
  const addNote = (id: string, line: string) => extra.set(id, [...(extra.get(id) ?? []), line]);

  for (const r of indis) {
    const id = uid();
    ids.set(r.xref, id);
    const names = childrenOf(r, 'NAME');
    const isBirthName = (n: Node) => /^(birth|maiden)$/i.test(child(n, 'TYPE')?.value.trim() ?? '');
    const primary = names.find((n) => !isBirthName(n)) ?? names[0];
    const birthNameNode = names.find((n) => n !== primary && isBirthName(n));
    const { given, surname } = primary ? readName(primary) : { given: '', surname: '' };
    const birthSurname = birthNameNode ? readName(birthNameNode).surname : '';

    const sex = child(r, 'SEX')?.value.trim().toUpperCase();
    const gender: Gender = sex === 'M' ? 'male' : sex === 'F' ? 'female' : 'other';

    const birt = child(r, 'BIRT');
    const chr = child(r, 'CHR') ?? child(r, 'BAPM');
    const deat = child(r, 'DEAT');
    const buri = child(r, 'BURI') ?? child(r, 'CREM');

    let birthDate = '';
    const birthRaw = child(birt, 'DATE')?.value ?? '';
    if (birthRaw) {
      const { date, exact } = readDate(birthRaw);
      birthDate = date;
      if (!exact) addNote(id, `Birth date in imported file: ${birthRaw.trim()}`);
    } else if (child(chr, 'DATE')) {
      const raw = child(chr, 'DATE')!.value;
      birthDate = readDate(raw).date;
      if (birthDate) addNote(id, `Birth date taken from christening/baptism: ${raw.trim()}`);
    }
    const birthPlace = place(birt) || place(chr);

    let deathDate = '';
    const deathRaw = child(deat, 'DATE')?.value ?? '';
    if (deathRaw) {
      const { date, exact } = readDate(deathRaw);
      deathDate = date;
      if (!exact) addNote(id, `Death date in imported file: ${deathRaw.trim()}`);
    }
    if (place(deat)) addNote(id, `Died in ${place(deat)}`);
    if (place(buri)) addNote(id, `Buried in ${place(buri)}`);
    for (const o of childrenOf(r, 'OCCU')) if (fullText(o)) addNote(id, `Occupation: ${fullText(o)}`);

    // Files often leave out death records for people long gone; don't show them as 250-year-olds.
    const birthYear = parseDate(birthDate).y;
    const longAgo = birthYear !== null && now.getFullYear() - birthYear > 110;
    const deceased = Boolean(deat || buri || deathDate || longAgo);

    const notes = childrenOf(r, 'NOTE').map(noteText).filter(Boolean);
    people[id] = {
      ...blankInput({
        firstName: given,
        lastName: surname,
        birthName: birthSurname && birthSurname !== surname ? birthSurname : '',
        gender,
        birthDate,
        deathDate,
        deceased,
        birthPlace,
      }),
      id,
      notes: notes.join('\n\n'),
      parentIds: [],
    };
  }

  // Families: couples, and which family each child belongs to.
  const unions: Union[] = [];
  const familyOfChild = new Map<string, { fam: Node; pedi: string }[]>();
  const fams = records.filter((r) => r.tag === 'FAM' && r.xref);
  const spousesOf = (fam: Node) =>
    [child(fam, 'HUSB')?.value.trim(), child(fam, 'WIFE')?.value.trim()]
      .map((x) => (x ? ids.get(x) : undefined))
      .filter((x): x is string => Boolean(x));

  for (const fam of fams) {
    const spouses = spousesOf(fam);
    if (spouses.length === 2 && spouses[0] !== spouses[1]) {
      const custom = child(fam, '_KINDRED_STATUS')?.value.trim();
      const status: UnionStatus = child(fam, 'DIV') ? 'divorced' : custom === 'partner' ? 'partner' : 'married';
      unions.push({ id: uid(), a: spouses[0], b: spouses[1], status });
      // There's nowhere to put a marriage date or place yet, so keep them in both people's notes.
      const marr = child(fam, 'MARR');
      const when = formatDate(readDate(child(marr, 'DATE')?.value ?? '').date);
      const where = place(marr);
      if (when || where) {
        for (const [me, other] of [spouses, [...spouses].reverse()]) {
          const detail = [when && `on ${when}`, where && `in ${where}`].filter(Boolean).join(' ');
          addNote(me, `Married ${displayName(people[other])} ${detail}`);
        }
      }
    }
    for (const c of childrenOf(fam, 'CHIL')) {
      const cid = ids.get(c.value.trim());
      if (cid) familyOfChild.set(cid, [...(familyOfChild.get(cid) ?? []), { fam, pedi: '' }]);
    }
  }
  // A person's own FAMC lines say which family comes first and whether they were adopted.
  for (const r of indis) {
    const cid = ids.get(r.xref)!;
    const listed = familyOfChild.get(cid) ?? [];
    const ordered: { fam: Node; pedi: string }[] = [];
    for (const famc of childrenOf(r, 'FAMC')) {
      const fam = byXref.get(famc.value.trim());
      if (fam?.tag === 'FAM') ordered.push({ fam, pedi: child(famc, 'PEDI')?.value.trim().toLowerCase() ?? '' });
    }
    for (const l of listed) if (!ordered.some((o) => o.fam === l.fam)) ordered.push(l);
    // Kindred holds one set of parents: prefer birth parents when the file says which they are.
    const chosen = ordered.find((o) => !/adopted|foster|sealing/.test(o.pedi)) ?? ordered[0];
    if (!chosen) continue;
    people[cid].parentIds = spousesOf(chosen.fam).filter((pid) => pid !== cid);
    const others = ordered.filter((o) => o !== chosen && spousesOf(o.fam).length > 0);
    for (const o of others) {
      const names = spousesOf(o.fam).map((pid) => displayName(people[pid])).join(' and ');
      addNote(cid, `${o.pedi === 'adopted' ? 'Adopted by' : o.pedi === 'foster' ? 'Fostered by' : 'Also listed as the child of'} ${names}`);
    }
  }

  for (const [id, lines] of extra) {
    const p = people[id];
    p.notes = [p.notes, lines.join('\n')].filter(Boolean).join('\n\n');
  }

  const head = records[0];
  const name = child(head, '_KINDRED_TREE') ? fullText(child(head, '_KINDRED_TREE')!) : fallbackName;
  const tree = sanitizeTree({
    version: 1,
    name: name || fallbackName,
    people,
    unions,
    homeId: ids.get(indis[0].xref) ?? null,
  });
  return { tree, count: Object.keys(tree.people).length };
}

/**
 * Reads a GEDCOM file's bytes. Most are UTF-8; older ones are often Windows-1252 (or
 * ANSEL, which mostly reads correctly that way apart from accented letters).
 */
export function decodeGedcom(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}

/** "smith_family-tree.ged" → "Smith family tree" */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'My Family';
}
