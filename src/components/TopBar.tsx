import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CalendarHeart,
  Check,
  ChartGantt,
  Download,
  Ellipsis,
  Hand,
  FileText,
  Image,
  Keyboard,
  Languages,
  Moon,
  Network,
  Redo2,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  TreeDeciduous,
  Undo2,
  Upload,
} from 'lucide-react';
import type { Person } from '../types';
import { useStore, type ViewMode } from '../store';
import { exportBackup, exportGedcom, exportImage, pickBackupFile } from '../lib/actions';
import { ageOf, lifespan } from '../lib/dates';
import { searchIndex, searchPeople } from '../lib/search';
import { birthdayBook, onDay, today as startOfToday } from '../lib/almanac';
import { factsOf } from '../lib/facts';
import { NAMINGS, relationLabels } from '../lib/naming';
import { fullName, hasPeople } from '../lib/tree';
import { isTouch } from '../lib/touchHold';
import { Avatar } from './Avatar';

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path
        d="M16 13v5M9 23v-2.5a2.5 2.5 0 0 1 2.5-2.5h9a2.5 2.5 0 0 1 2.5 2.5V23"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="10" r="3" fill="var(--on-accent)" />
      <circle cx="9" cy="24" r="2.5" fill="var(--on-accent)" />
      <circle cx="23" cy="24" r="2.5" fill="var(--on-accent)" />
    </svg>
  );
}

function TreeName() {
  const tree = useStore((s) => s.tree);
  const commit = useStore((s) => s.commit);
  const [draft, setDraft] = useState<string | null>(null);

  const save = () => {
    if (draft === null) return;
    const name = draft.trim() || 'My Family';
    if (name !== tree.name) commit({ ...tree, name });
    setDraft(null);
  };

  return (
    <input
      className="tree-name"
      aria-label="Tree name"
      value={draft ?? tree.name}
      spellCheck={false}
      size={Math.max(6, (draft ?? tree.name).length)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** A short stretch of a note around the word that matched. */
function snippet(text: string, word: string): string {
  const flat = text.replace(/\s+/g, ' ');
  const at = Math.max(0, flat.toLowerCase().indexOf(word));
  const start = Math.max(0, at - 14);
  const end = Math.min(flat.length, start + 44);
  return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '');
}

/**
 * Why a result matched, when it isn't plain. The relationship and years already show in
 * the result's subtitle; a place or note match needs spelling out, or it looks unexplained.
 */
function whyMatched(p: Person, field: number, word: string): string {
  if (field === 0) return `Born ${p.birthName}`;
  if (field === 2) return `Born in ${p.birthPlace}`;
  if (field === 4) return `“${snippet(p.notes, word)}”`;
  return '';
}

/** What someone does and how far they studied, when their notes say. */
function work(p: Person): string {
  const facts = factsOf(p.notes);
  return [facts.occupation, facts.education].filter(Boolean).join(' · ');
}

function SearchBox() {
  const tree = useStore((s) => s.tree);
  const select = useStore((s) => s.select);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const naming = useStore((s) => s.naming);
  const kin = relationLabels(tree, naming);

  // With a big tree, matching can lag behind fast typing; the box itself never does.
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim() !== '';

  // Everyone's searchable text, lowercased once per tree (built when the first word is typed).
  const index = useMemo(() => (searching ? searchIndex(tree) : []), [tree, searching]);

  // Matches names first, then anything else known about a person: relationship
  // ("cousin"), birthplace ("Cardiff"), years ("1960") and notes. Every word must match.
  const results = useMemo(() => {
    return searchPeople(index, deferredQuery).map(({ person, rank, field, word }) => ({
      person, rank, why: field < 0 ? '' : whyMatched(person, field, word),
    }));
  }, [index, deferredQuery]);

  // "/" jumps to search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const choose = (id: string) => {
    select(id, true);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="search">
      <Search size={16} className="search-icon" />
      <input
        ref={inputRef}
        className="search-input"
        placeholder="Search people…"
        title="Search by name, place, year or relationship"
        aria-label="Find someone in the tree"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            choose(results[active].person.id);
          } else if (e.key === 'Escape') {
            setQuery('');
            e.currentTarget.blur();
          }
        }}
      />
      <kbd className="search-kbd">/</kbd>
      {open && query.trim() && (
        <ul className="search-results" role="listbox">
          {results.length === 0 && (
            <li className="search-empty">
              No matches. Try a name, a place, a year or a relationship like “aunt”.
            </li>
          )}
          {results.map(({ person: p, why }, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`search-result${i === active ? ' is-active' : ''}`}
                // mousedown so the choice lands before the input's blur closes the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p.id);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <Avatar person={p} size={30} />
                <span className="rel-text">
                  <span className="rel-name">{fullName(tree, p)}</span>
                  <span className="rel-sub">
                    {kin.get(p.id) && <span className="search-kin">{kin.get(p.id)}</span>}
                    {kin.get(p.id) && lifespan(p) && ' · '}
                    {lifespan(p)}
                  </span>
                  {why ? (
                    <span className="rel-sub search-why">{why}</span>
                  ) : (
                    work(p) && <span className="rel-sub search-work">{work(p)}</span>
                  )}
                </span>
                {ageOf(p) !== null && (
                  <span className={`search-age${p.deceased || p.deathDate ? ' is-past' : ''}`} aria-label={`Age ${ageOf(p)}`}>
                    {ageOf(p)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MainMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { undo, redo } = useStore.getState();
  const theme = useStore((s) => s.theme);
  const naming = useStore((s) => s.naming);
  const { toggleTheme, setNaming } = useStore.getState();
  const empty = useStore((s) => !hasPeople(s.tree));
  const openDialog = useStore((s) => s.openDialog);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (label: string, icon: ReactNode, run: () => void, opts: { disabled?: boolean; danger?: boolean; mobileHistory?: boolean; mobilePreference?: boolean } = {}) => (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${opts.danger ? ' is-danger' : ''}${opts.mobileHistory ? ' mobile-history' : ''}${opts.mobilePreference ? ' mobile-preference' : ''}`}
      disabled={opts.disabled}
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        data-tip={open ? undefined : 'More'}
        onClick={() => setOpen((o) => !o)}
      >
        <Ellipsis size={18} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {/* The header has no room for the tree's name on a phone; it is renamed here. */}
          <div className="menu-tree-name">
            <TreeName />
          </div>
          {item('Undo', <Undo2 size={16} />, undo, { disabled: !canUndo, mobileHistory: true })}
          {item('Redo', <Redo2 size={16} />, redo, { disabled: !canRedo, mobileHistory: true })}
          {item('Family almanac', <CalendarHeart size={16} />, () => openDialog({ type: 'insights', tab: 'upcoming' }), { mobilePreference: true, disabled: empty })}
          {NAMINGS.map((n) => (
            <button key={n.value} type="button" role="menuitemradio" aria-checked={naming === n.value} className="menu-item mobile-preference" onClick={() => { setNaming(n.value); setOpen(false); }}>
              <Languages size={16} /><span>{n.label}</span>{naming === n.value && <Check size={16} />}
            </button>
          ))}
          {item('Save as image', <Image size={16} />, () => void exportImage(), { disabled: empty })}
          {item('Export backup', <Download size={16} />, () => void exportBackup(), { disabled: empty })}
          {item('Export GEDCOM (.ged)', <FileText size={16} />, exportGedcom, { disabled: empty })}
          {item('Import backup or GEDCOM…', <Upload size={16} />, pickBackupFile)}
          <hr />
          {item(theme === 'dark' ? 'Light theme' : 'Dark theme', theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />, toggleTheme)}
          {item(
            isTouch() ? 'Gestures and shortcuts' : 'Keyboard shortcuts',
            isTouch() ? <Hand size={16} /> : <Keyboard size={16} />,
            () => openDialog({ type: 'shortcuts' }),
          )}
          {item('Load sample family', <Sparkles size={16} />, () => openDialog({ type: 'sample' }))}
          {item('Start over', <RotateCcw size={16} />, () => openDialog({ type: 'reset' }), { disabled: empty, danger: true })}
        </div>
      )}
    </div>
  );
}

/** The words relationships are named in - English, ગુજરાતી, or Gujarati in English letters - and the script of people's names. */
function NamingMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const naming = useStore((s) => s.naming);
  const setNaming = useStore((s) => s.setNaming);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Names and relationships"
        data-tip={open ? undefined : 'Names and relationships (L)'}
        onClick={() => setOpen((o) => !o)}
      >
        <Languages size={17} />
      </button>
      {open && (
        <div className="menu-pop naming-pop" role="menu" aria-label="Names and relationships">
          <h3>Names and relationships</h3>
          {NAMINGS.map((n) => (
            <button
              key={n.value}
              type="button"
              role="menuitemradio"
              aria-checked={naming === n.value}
              className="menu-item naming-item"
              onClick={() => {
                setNaming(n.value);
                setOpen(false);
              }}
            >
              <span className="naming-text">
                <span>{n.label}</span>
                <span className="naming-example">{n.example}</span>
              </span>
              <Check size={16} className="naming-check" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tree, descendants fan or timeline. */
function ViewSwitch() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const keys: Record<ViewMode, string> = { tree: 'T', timeline: 'T', fan: 'D' };
  const option = (value: ViewMode, label: string, icon: ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      aria-label={label}
      data-tip={mode === value ? undefined : `${label} (${keys[value]})`}
      onClick={() => setMode(value)}
    >
      {icon}
      <span className="view-switch-label">{label}</span>
    </button>
  );
  return (
    <div className="segmented view-switch" role="radiogroup" aria-label="View">
      {option('tree', 'Tree', <Network size={15} />)}
      {option('fan', 'Descendants', <TreeDeciduous size={15} />)}
      {option('timeline', 'Timeline', <ChartGantt size={15} />)}
    </div>
  );
}

/** Opens the calendar & checks dialog. A dot means someone has a birthday (or anniversary) today. */
function InsightsButton() {
  const tree = useStore((s) => s.tree);
  const openDialog = useStore((s) => s.openDialog);
  const today = useMemo(() => onDay(birthdayBook(tree), startOfToday()), [tree]);
  const label = today.length > 0 ? `Family almanac - ${today.length} today` : 'Family almanac';
  return (
    <button
      type="button"
      className="icon-btn insights-btn header-secondary"
      onClick={() => openDialog({ type: 'insights', tab: 'upcoming' })}
      aria-label={label}
      data-tip={today.length > 0 ? `Almanac · ${today.length} today` : 'Family almanac'}
    >
      <CalendarHeart size={17} />
      {today.length > 0 && <span className="insights-dot" aria-hidden="true" />}
    </button>
  );
}

export function TopBar() {
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { undo, redo } = useStore.getState();
  const empty = useStore((s) => !hasPeople(s.tree));

  // Three fixed parts - the tree's name, the views, then search and app actions - so
  // nothing in the header moves when you switch views or open something. Each view's
  // own controls float on the view itself.
  return (
    <header className="topbar">
      <div className="topbar-start brand">
        <Logo />
        <TreeName />
      </div>

      <div className="topbar-center">{!empty && <ViewSwitch />}</div>

      <div className="topbar-end">
        {!empty && (
          <div className="topbar-search">
            <SearchBox />
          </div>
        )}
        <div className="topbar-history">
          <button type="button" className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" data-tip="Undo (Ctrl+Z)">
            <Undo2 size={17} />
          </button>
          <button type="button" className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" data-tip="Redo (Ctrl+Shift+Z)">
            <Redo2 size={17} />
          </button>
        </div>
        <div className="topbar-actions">
          {!empty && <InsightsButton />}
          {!empty && <span className="header-secondary"><NamingMenu /></span>}
          <MainMenu />
        </div>
      </div>
    </header>
  );
}
