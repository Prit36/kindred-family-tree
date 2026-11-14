import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Search } from 'lucide-react';
import type { Person, Tree } from '../types';
import { useStore } from '../store';
import { lifespan } from '../lib/dates';
import { relationLabels } from '../lib/naming';
import { searchIndex } from '../lib/search';
import { displayName, indexOf, parentsOf, partnersOf, shortName } from '../lib/tree';
import { Avatar } from './Avatar';

/** How many rows are drawn at once; the rest are counted. */
const SHOWN = 40;

/** Steps from `fromId` to everyone reachable, through parents, children and partners. */
function distancesFrom(tree: Tree, fromId: string): Map<string, number> {
  const idx = indexOf(tree);
  const dist = new Map<string, number>([[fromId, 0]]);
  let frontier = [fromId];
  for (let d = 1; frontier.length; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      const p = tree.people[cur];
      if (!p) continue;
      const near = [
        ...p.parentIds,
        ...(idx.children.get(cur) ?? []),
        ...(idx.unions.get(cur) ?? []).map((u) => (u.a === cur ? u.b : u.a)),
      ];
      for (const n of near) {
        if (dist.has(n) || !tree.people[n]) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

const byGender = (p: Person, male: string, female: string, other: string) =>
  p.gender === 'male' ? male : p.gender === 'female' ? female : other;

/** What tells two people with the same name apart: whose child and whose partner they are. */
function context(tree: Tree, p: Person): string {
  const parts: string[] = [];
  const parents = parentsOf(tree, p.id);
  if (parents.length) parts.push(`${byGender(p, 'Son', 'Daughter', 'Child')} of ${parents.map(shortName).join(' & ')}`);
  const partners = partnersOf(tree, p.id);
  if (partners.length)
    parts.push(`${byGender(p, 'Husband', 'Wife', 'Partner')} of ${partners.map((x) => shortName(x.person)).join(', ')}`);
  if (!parts.length && p.birthPlace) parts.push(p.birthPlace);
  return parts.join(' · ');
}

/**
 * Choosing someone already in the tree: a search box over everyone who could be linked,
 * each listed with what sets them apart from others of the same name - their relation
 * to you, their parents and partner. People closest to `anchorId` in the tree come first.
 * Nobody is chosen until one is picked.
 */
export function PersonPicker({
  candidates,
  anchorId,
  value,
  onChange,
  onConfirm,
}: {
  candidates: Person[];
  anchorId: string;
  value: string;
  onChange: (id: string) => void;
  /** Enter on the chosen person */
  onConfirm: () => void;
}) {
  const tree = useStore((s) => s.tree);
  const naming = useStore((s) => s.naming);
  const kin = relationLabels(tree, naming);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const dist = useMemo(() => distancesFrom(tree, anchorId), [tree, anchorId]);
  const entries = useMemo(() => {
    const allowed = new Set(candidates.map((p) => p.id));
    return searchIndex(tree).filter((e) => allowed.has(e.person.id));
  }, [tree, candidates]);

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // Not connected at all: after everyone who is (a number, so the sort below never sees NaN).
    const far = (id: string) => dist.get(id) ?? 1e9;
    const scored: { person: Person; score: number }[] = [];
    for (const e of entries) {
      let score = 0;
      if (words.length) {
        const nameWords = e.name.split(/\s+/);
        let ok = true;
        for (const w of words) {
          if (nameWords.some((n) => n.startsWith(w))) continue;
          if (e.name.includes(w)) score = Math.max(score, 1);
          else if (e.fields.some((f) => f.includes(w))) score = Math.max(score, 2);
          else {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      scored.push({ person: e.person, score });
    }
    // Best match first, then whoever is nearest in the tree; the index is already alphabetical.
    return scored.sort((a, b) => a.score - b.score || far(a.person.id) - far(b.person.id)).map((s) => s.person);
  }, [entries, query, dist]);

  const shown = results.slice(0, SHOWN);
  // Names that appear more than once among these, so the details under them matter.
  const repeated = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of results) seen.set(displayName(p), (seen.get(displayName(p)) ?? 0) + 1);
    return seen;
  }, [results]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const p = shown[active];
      if (!p) return;
      if (p.id === value) onConfirm();
      else onChange(p.id);
    }
  };

  const optionId = (i: number) => `pick-${anchorId}-${i}`;

  return (
    <div className="picker">
      <label className="picker-search">
        <Search size={15} aria-hidden="true" />
        <input
          className="input"
          type="search"
          value={query}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Name, year or place"
          aria-label="Find someone in the tree"
          role="combobox"
          aria-expanded="true"
          aria-controls={`pick-${anchorId}`}
          aria-activedescendant={shown.length ? optionId(active) : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
      </label>

      <div className="picker-list" id={`pick-${anchorId}`} role="listbox" aria-label="People" ref={listRef}>
        {shown.map((p, i) => {
          const relation = kin.get(p.id);
          const about = context(tree, p);
          const chosen = p.id === value;
          return (
            <div
              key={p.id}
              id={optionId(i)}
              data-index={i}
              role="option"
              aria-selected={chosen}
              className={`picker-row${i === active ? ' is-active' : ''}${chosen ? ' is-chosen' : ''}`}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => onChange(chosen ? '' : p.id)}
            >
              <Avatar person={p} size={34} />
              <span className="picker-text">
                <span className="picker-name">
                  <span className="picker-name-text">{displayName(p)}</span>
                  {lifespan(p) && <span className="picker-years">{lifespan(p)}</span>}
                  {(repeated.get(displayName(p)) ?? 0) > 1 && (
                    <span className="picker-same" data-tip="More than one person has this name">
                      ×{repeated.get(displayName(p))}
                    </span>
                  )}
                </span>
                {(relation || about) && (
                  <span className="picker-about" title={[relation, about].filter(Boolean).join(' · ')}>
                    {relation && <span className="picker-rel">{relation}</span>}
                    {about}
                  </span>
                )}
              </span>
              <span className="picker-check" aria-hidden="true">
                {chosen && <Check size={15} strokeWidth={2.6} />}
              </span>
            </div>
          );
        })}
        {shown.length === 0 && <p className="picker-empty">Nobody matches “{query.trim()}”</p>}
        {results.length > SHOWN && (
          <p className="picker-more">
            {(results.length - SHOWN).toLocaleString()} more {results.length - SHOWN === 1 ? 'match' : 'matches'}
          </p>
        )}
      </div>
    </div>
  );
}
