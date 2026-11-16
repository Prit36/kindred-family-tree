import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Network, Search } from 'lucide-react';
import type { Tree } from '../types';
import type { LineStop } from '../store';
import { familyIndex, familyLines, familyWords, lineHead, lineIds, lineSearchText, lineTitle } from '../lib/lines';
import { searchIndex, searchPeople } from '../lib/search';
import { fullName, shortName } from '../lib/tree';
import { useStore } from '../store';
import type { Naming } from '../lib/naming';
import { FamilyChips, type DeckCard } from './FamilyDeck';

interface FamilyBarProps {
  tree: Tree;
  /** The families visited, ending with the one on show */
  trail: LineStop[];
  /** The families linked to the one on show by a marriage (the deck) */
  linked: DeckCard[];
  onGo: (line: string, via: string) => void;
  /** One of the linked families was chosen */
  onLinked: (card: DeckCard) => void;
  /** A linked family is pointed at (its threads light up), or none */
  onHot: (line: string | null) => void;
  onWholeTree: () => void;
}

/**
 * Top left of the canvas while it shows one family: the way back through the families
 * visited, and the family on show, which opens a list of every family in the tree.
 */
export function FamilyBar({ tree, trail, linked, onGo, onLinked, onHot, onWholeTree }: FamilyBarProps) {
  const here = trail.at(-1)!;
  const earlier = trail.slice(0, -1);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const naming = useStore((s) => s.naming);
  const words = familyWords(naming);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const name = lineTitle(tree, here.line, naming, here.via);
  const size = lineIds(tree, here.line).size;
  const head = lineHead(tree, here.line, naming);

  return (
    <div className="family-bar" ref={ref}>
      <nav className="view-bar line-trail" aria-label="Families visited">
        {earlier.map((stop) => {
          const stopName = lineTitle(tree, stop.line, naming, stop.via);
          return (
            <Fragment key={stop.line}>
              <button
                type="button"
                className="line-trail-step"
                onClick={() => onGo(stop.line, stop.via)}
                data-tip={`Back to ${stopName}`}
                aria-label={`Back to ${stopName}`}
              >
                {stopName}
              </button>
              <ChevronRight className="line-trail-sep" size={14} aria-hidden="true" />
            </Fragment>
          );
        })}
        <button
          type="button"
          className="line-trail-step is-here"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${name}, ${words.people(size)}. Choose another family`}
          data-tip={open ? undefined : [head, words.people(size)].filter(Boolean).join(' · ')}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="line-trail-name">{name}</span>
          <ChevronDown size={15} className="line-trail-chev" aria-hidden="true" />
        </button>
        {linked.length > 0 && <span className="family-bar-sep" aria-hidden="true" />}
        <FamilyChips tree={tree} cards={linked} onGo={onLinked} onHot={onHot} />
      </nav>
      {open && (
        <FamilyPicker
          tree={tree}
          naming={naming}
          current={here.line}
          linked={linked}
          onPick={(line, via) => {
            setOpen(false);
            onGo(line, via);
          }}
          onWholeTree={() => {
            setOpen(false);
            onWholeTree();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

interface Row {
  line: string;
  /** Who it's reached through: whoever leads there, or the person searched for */
  via: string;
  name: string;
  sub: string;
}

interface PickerProps {
  tree: Tree;
  naming: Naming;
  current: string;
  linked: DeckCard[];
  onPick: (line: string, via: string) => void;
  onWholeTree: () => void;
  onClose: () => void;
}

function FamilyPicker({ tree, naming, current, linked, onPick, onWholeTree, onClose }: PickerProps) {
  const words = familyWords(naming);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const lines = familyLines(tree);
  const rowOf = (line: string, via: string, extra?: string): Row => ({
    line,
    via,
    name: lineTitle(tree, line, naming, via === line ? undefined : via),
    sub: [extra ?? lineHead(tree, line, naming), words.people(lineIds(tree, line).size)].filter(Boolean).join(' · '),
  });

  const index = useMemo(() => (query.trim() ? searchIndex(tree) : null), [query, tree]);
  const groups = useMemo((): { title: string; rows: Row[] }[] => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const near = linked.map((c) =>
        rowOf(c.line, c.via[0], words.via(c.via.map((id) => shortName(tree.people[id])))),
      );
      const all = familyIndex(tree).map((f) => rowOf(f.key, f.key));
      return [
        { title: words.linkedHeading, rows: near },
        { title: words.allHeading, rows: all },
      ].filter((g) => g.rows.length > 0);
    }
    // Families called by what was typed, then the families of people called by it.
    const byName = familyIndex(tree)
      .filter((f) => lineSearchText(tree, f.key, naming).includes(q))
      .map((f) => rowOf(f.key, f.key));
    const seen = new Set(byName.map((r) => r.line));
    const byPerson: Row[] = [];
    for (const { person } of searchPeople(index!, query, 40)) {
      const line = lines.lineOf.get(person.id);
      if (!line || seen.has(line)) continue;
      seen.add(line);
      byPerson.push(rowOf(line, person.id, fullName(tree, person)));
    }
    return [
      { title: words.familiesHeading, rows: byName },
      { title: words.foundHeading, rows: byPerson },
    ].filter((g) => g.rows.length > 0);
    // rowOf reads only tree, lines and the naming, all covered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, index, tree, linked, naming]);
  const rows = groups.flatMap((g) => g.rows);

  // Keep the row picked with the keys in sight.
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let n = 0;
  return (
    <div className="fan-picker-pop family-picker" role="dialog" aria-label="Choose a family">
      <div className="fan-picker-search">
        <Search size={15} />
        <input
          ref={inputRef}
          value={query}
          placeholder={words.findPlaceholder}
          aria-label="Find a family or someone in it"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, rows.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && rows[active]) {
              onPick(rows[active].line, rows[active].via);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              onClose();
            }
          }}
        />
      </div>
      <div className="fan-picker-list" ref={listRef} role="listbox" aria-label="Families">
        {rows.length === 0 && <div className="search-empty">{words.nothingFound}</div>}
        {groups.map((g) => (
          <Fragment key={g.title}>
            <h3 className="fan-picker-heading">{g.title}</h3>
            {g.rows.map((r) => {
              const i = n++;
              return (
                <button
                  key={`${g.title}:${r.line}`}
                  type="button"
                  role="option"
                  aria-selected={r.line === current}
                  className={`search-result family-row${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(r.line, r.via)}
                >
                  <span className="rel-text">
                    <span className="rel-name">{r.name}</span>
                    <span className="rel-sub">{r.sub}</span>
                  </span>
                  {r.line === current && <Check size={16} className="fan-picker-check" />}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
      <button type="button" className="family-picker-whole" onClick={onWholeTree}>
        <Network size={15} />
        {words.wholeTree}
      </button>
    </div>
  );
}
