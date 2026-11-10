import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, Ellipsis, Image, Moon, Redo2, RotateCcw, Search, Sparkles, Sun, Undo2, Upload } from 'lucide-react';
import { useStore } from '../store';
import { exportBackup, exportImage, pickBackupFile } from '../lib/actions';
import { lifespan } from '../lib/dates';
import { kinshipFor } from '../lib/kinship';
import { displayName } from '../lib/tree';
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

function SearchBox() {
  const tree = useStore((s) => s.tree);
  const select = useStore((s) => s.select);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return Object.values(tree.people)
      .filter((p) => displayName(p).toLowerCase().includes(q))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)))
      .slice(0, 8);
  }, [tree, query]);
  const kin = kinshipFor(tree);

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
        placeholder="Find someone"
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
            choose(results[active].id);
          } else if (e.key === 'Escape') {
            setQuery('');
            e.currentTarget.blur();
          }
        }}
      />
      <kbd className="search-kbd">/</kbd>
      {open && query.trim() && (
        <ul className="search-results" role="listbox">
          {results.length === 0 && <li className="search-empty">No one by that name</li>}
          {results.map((p, i) => (
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
                  <span className="rel-name">{displayName(p)}</span>
                  <span className="rel-sub">{[kin.get(p.id), lifespan(p)].filter(Boolean).join(' · ')}</span>
                </span>
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
  const empty = useStore((s) => Object.keys(s.tree.people).length === 0);
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

  const item = (label: string, icon: ReactNode, run: () => void, opts: { disabled?: boolean; danger?: boolean } = {}) => (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${opts.danger ? ' is-danger' : ''}`}
      disabled={opts.disabled}
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      {icon}
      {label}
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
          {item('Save as image', <Image size={16} />, () => void exportImage(), { disabled: empty })}
          {item('Export backup', <Download size={16} />, exportBackup, { disabled: empty })}
          {item('Import backup…', <Upload size={16} />, pickBackupFile)}
          <hr />
          {item('Load sample family', <Sparkles size={16} />, () => openDialog({ type: 'sample' }))}
          {item('Start over', <RotateCcw size={16} />, () => openDialog({ type: 'reset' }), { disabled: empty, danger: true })}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const theme = useStore((s) => s.theme);
  const { undo, redo, toggleTheme } = useStore.getState();
  const empty = useStore((s) => Object.keys(s.tree.people).length === 0);

  return (
    <header className="topbar">
      <div className="topbar-group brand">
        <Logo />
        <TreeName />
      </div>

      {!empty && (
        <div className="topbar-group topbar-search">
          <SearchBox />
        </div>
      )}

      <div className="topbar-group">
        <button type="button" className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" data-tip="Undo (Ctrl+Z)">
          <Undo2 size={17} />
        </button>
        <button type="button" className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" data-tip="Redo (Ctrl+Shift+Z)">
          <Redo2 size={17} />
        </button>
        <span className="divider" />
        <button
          type="button"
          className="icon-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          data-tip={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <MainMenu />
      </div>
    </header>
  );
}
