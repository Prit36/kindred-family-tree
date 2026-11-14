import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Camera,
  ChevronDown,
  ChevronRight,
  Expand,
  Heart,
  House,
  Lock,
  Pencil,
  Plus,
  Trash,
  Unlink,
  X,
} from 'lucide-react';
import type { Person, Relation, Tree, Union, UnionStatus } from '../types';
import { useStore } from '../store';
import { addRelative, pickPhotoFor, viewPhoto } from '../lib/actions';
import { focusSet, sameFocus, type FocusScope } from '../lib/branches';
import { familySides } from '../lib/sides';
import { ageOf, compareByBirth, formatDate, lifespan, parseDate, yearOf } from '../lib/dates';
import { relationLabels, relationName } from '../lib/naming';
import {
  childrenOf,
  displayName,
  isPlaceholder,
  parentsOf,
  partnersOf,
  pathBetween,
  removeUnion,
  setUnionStatus,
  sharedChildren,
  shortName,
  siblingsOf,
  unlinkParent,
} from '../lib/tree';
import { Avatar } from './Avatar';

/** Ways to show only part of the tree around someone, narrowest first. */
const SCOPES: { scope: FocusScope; label: string; tip: string; key?: string }[] = [
  { scope: 'line', label: 'Line', tip: 'their ancestors and descendants', key: 'B' },
  { scope: 'close', label: 'Close', tip: 'their parents, siblings, children and partners' },
  { scope: 'family', label: 'Family', tip: 'every blood relative - aunts, uncles, cousins', key: 'Shift+B' },
];

type AddOption = { relation: Relation; label: string; icon: ReactNode };

/** Each arrow points where the new person goes in the tree. */
const ADD: AddOption[] = [
  { relation: 'parent', label: 'Parent', icon: <ArrowUp size={16} /> },
  { relation: 'partner', label: 'Partner', icon: <Heart size={16} /> },
  { relation: 'sibling', label: 'Sibling', icon: <ArrowLeftRight size={16} /> },
  { relation: 'child', label: 'Child', icon: <ArrowDown size={16} /> },
];

const STATUS_LABEL: Record<UnionStatus, string> = { married: 'married', partner: 'partners', divorced: 'divorced' };

/**
 * What gives way, in turn, when there isn't room: a generation too wide for one line
 * folds into a stack of faces (siblings, if that's still too wide, into bare faces);
 * a panel too short clamps the notes, then drops the years under each name.
 */
type Fold = 'sibling' | 'siblingTight' | 'child' | 'notes' | 'compact';

type Box = { x: number; cy: number; top: number; bottom: number; left: number; right: number };

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id));

/** A partial date as a fractional year, the unknown parts taken from the middle. */
function yearFrac(s: string): number | null {
  const { y, m, d } = parseDate(s);
  if (!y) return null;
  if (!m) return y + 0.5;
  return y + (m - 1) / 12 + (d ? (d - 1) / 365 : 1 / 24);
}

/** How many people descend from someone. */
function descendantCount(tree: Tree, id: string) {
  const seen = new Set([id]);
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier)
      for (const child of childrenOf(tree, cur))
        if (!seen.has(child.id)) {
          seen.add(child.id);
          next.push(child.id);
        }
    frontier = next;
  }
  return seen.size - 1;
}

/** "1987" or "1987–1994" */
function yearSpan(people: Person[]): string {
  const years = people.map((p) => yearOf(p.birthDate)).filter((y): y is number => y !== null);
  if (!years.length) return '';
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

export function PersonPanel() {
  const person = useStore((s) => (s.selectedId ? s.tree.people[s.selectedId] : undefined));
  // A fresh panel per person, so nothing folded for one carries over to the next.
  return person ? <Details key={person.id} person={person} /> : null;
}

function Details({ person }: { person: Person }) {
  const tree = useStore((s) => s.tree);
  const focus = useStore((s) => s.focus);
  const naming = useStore((s) => s.naming);
  const { select, commit, openDialog, toast, undo, focusOn, clearFocus } = useStore.getState();

  const kin = relationLabels(tree, naming);
  const isHome = tree.homeId === person.id;
  const relation = kin.get(person.id);
  // A Gujarati name's meaning in English, on hover: "Father's younger brother".
  const meaning = !isHome && tree.homeId ? (relationName(tree, tree.homeId, person.id, naming)?.meaning ?? '') : '';
  const age = ageOf(person);
  const placeholder = isPlaceholder(person);

  const parents = parentsOf(tree, person.id).sort(compareByBirth);
  // Former partners first, so the current one sits on the right.
  const partners = partnersOf(tree, person.id).sort(
    (a, b) => Number(b.union.status === 'divorced') - Number(a.union.status === 'divorced'),
  );
  const siblings = siblingsOf(tree, person.id).sort(compareByBirth);
  const children = childrenOf(tree, person.id).sort(compareByBirth);
  const descendants = descendantCount(tree, person.id);

  const birthName =
    person.birthName && person.birthName !== person.lastName
      ? `${person.gender === 'male' ? 'né' : person.gender === 'female' ? 'née' : 'born'} ${person.birthName}`
      : '';

  // The people in between explain a label like "Cousin once removed" better than the label does.
  const chain = !isHome && tree.homeId ? pathBetween(tree, tree.homeId, person.id) : null;
  const via = chain && chain.length > 2 ? chain.slice(1, -1) : [];

  // Each way of focusing only earns its place when it would clear people out of the way,
  // and show something the narrower ones don't.
  const total = Object.keys(tree.people).length;
  const scopes: ((typeof SCOPES)[number] & { size: number })[] = [];
  const seen: ReadonlySet<string>[] = [];
  for (const option of SCOPES) {
    const ids = focusSet(tree, { id: person.id, scope: option.scope });
    if (ids.size >= total || seen.some((other) => sameSet(other, ids))) continue;
    seen.push(ids);
    scopes.push({ ...option, size: ids.size });
  }
  const focusedScope = focus?.id === person.id ? focus.scope : null;

  // Which side of the family they're on, unless that's obvious (it's you).
  const sides = familySides(tree);
  const side = isHome ? undefined : sides.byKey.get(sides.sideOf.get(person.id) ?? '');
  const sideActive = Boolean(side?.focus && sameFocus(side.focus, focus));

  const placeholderParent = parents.find(isPlaceholder);
  const parentsFull = person.parentIds.length >= 2 && !placeholderParent;

  const withUndo = (message: string) => toast(message, { action: { label: 'Undo', run: undo } });

  /* ---- Fitting it all in ------------------------------------------------------- */

  const bodyRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState<Fold[]>([]);
  const [viewport, setViewport] = useState(() => window.innerHeight);
  const [lines, setLines] = useState('');
  const [notesClamped, setNotesClamped] = useState(false);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    window.addEventListener('resize', onResize);
    // Names change width once the web fonts arrive; draw the lines again then.
    void document.fonts?.ready.then(redraw);
    const observer = new ResizeObserver(redraw);
    if (treeRef.current) observer.observe(treeRef.current);
    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
    };
  }, []);

  // Start over whenever the family or the room changes.
  useLayoutEffect(() => {
    setFolded((f) => (f.length ? [] : f));
  }, [tree, naming, viewport]);

  const isFolded = (f: Fold) => folded.includes(f);
  const fold = (f: Fold) => setFolded((all) => (all.includes(f) ? all : [...all, f]));

  useLayoutEffect(() => {
    const root = treeRef.current;
    const body = bodyRef.current;
    if (!root || !body) return;

    // Each generation keeps to one line: one that would wrap folds into a stack of faces.
    const wraps = (row: Element | null) => {
      const items = [...(row?.children ?? [])] as HTMLElement[];
      return items.some((el) => el.offsetTop > items[0].offsetTop + 4);
    };
    const mid = root.querySelector('.pp-gen.is-mid');
    if (siblings.length && !isFolded('sibling') && wraps(mid)) return fold('sibling');
    if (siblings.length && !isFolded('siblingTight') && wraps(mid)) return fold('siblingTight');
    if (children.length && !isFolded('child') && wraps(root.querySelector('.pp-gen.is-down'))) return fold('child');

    const d = treeLines(root);
    if (d !== lines) setLines(d);

    const notes = body.querySelector<HTMLElement>('.pp-notes');
    setNotesClamped(Boolean(notes && notes.scrollHeight > notes.clientHeight + 1));
    if (body.scrollHeight > body.clientHeight + 1) {
      const next = (['notes', 'compact'] as const).find((f) => !isFolded(f) && (f !== 'notes' || person.notes));
      if (next) fold(next);
    }
  });

  /* ---- The family tree --------------------------------------------------------- */

  const unlinkButton = (label: string, onClick: () => void) => (
    <button type="button" className="icon-btn pp-unlink" aria-label={label} data-tip="Remove link" onClick={onClick}>
      <Unlink size={12} />
    </button>
  );

  const tip = (p: Person) => [displayName(p), kin.get(p.id)].filter(Boolean).join(' · ');

  const node = (p: Person, role: 'parent' | 'sibling' | 'partner' | 'child', action?: ReactNode) => (
    <div key={p.id} className="pp-node" data-role={role}>
      <button
        type="button"
        className="pp-node-main"
        aria-label={[displayName(p), kin.get(p.id), lifespan(p)].filter(Boolean).join(', ')}
        data-tip={tip(p)}
        onClick={() => select(p.id, true)}
      >
        <span className="pp-anchor">
          <Avatar person={p} size={36} />
        </span>
        <span className="pp-node-name">{shortName(p)}</span>
        <span className="pp-node-sub">{lifespan(p) || ' '}</span>
      </button>
      {action}
    </div>
  );

  /** `tight`: faces alone, no name or years under them - for a line with no room for more. */
  const stack = (people: Person[], role: 'sibling' | 'child', max: number, tight = false) => {
    const shown = people.slice(0, people.length > max ? max - 1 : max);
    const rest = people.slice(shown.length);
    const label =
      people.length === 1 ? shortName(people[0]) : `${people.length} ${role === 'child' ? 'children' : 'siblings'}`;
    return (
      <div className={`pp-node pp-stack${tight ? ' is-tight' : ''}`} data-role={role}>
        <span className="pp-anchor pp-stack-faces">
          {shown.map((p) => (
            <button
              key={p.id}
              type="button"
              className="pp-stack-face"
              aria-label={tip(p)}
              data-tip={tip(p)}
              onClick={() => select(p.id, true)}
            >
              <Avatar person={p} size={36} />
            </button>
          ))}
          {rest.length > 0 && (
            <span className="pp-stack-more" data-tip={rest.map(shortName).join(', ')}>
              +{rest.length}
            </span>
          )}
        </span>
        {!tight && (
          <>
            <span className="pp-node-name">{label}</span>
            <span className="pp-node-sub">{yearSpan(people) || ' '}</span>
          </>
        )}
      </div>
    );
  };

  const link = (p: Person, union: Union) => (
    <div key={`link-${union.id}`} className="pp-link" data-status={union.status}>
      <select
        className="pp-link-status"
        aria-label={`Relationship with ${displayName(p)}`}
        value={union.status}
        onChange={(e) => commit(setUnionStatus(tree, union.id, e.target.value as UnionStatus))}
      >
        {(Object.keys(STATUS_LABEL) as UnionStatus[]).map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <span className="pp-link-line" />
    </div>
  );

  const partnerAction = (p: Person, union: Union) => {
    const shared = sharedChildren(tree, person.id, p.id);
    if (!shared.length)
      return unlinkButton(`Remove ${displayName(p)} as partner`, () => {
        commit(removeUnion(tree, union.id));
        withUndo(`${shortName(p)} is no longer linked as a partner`);
      });
    // Not hidden or dead: say why this couple can't be unlinked.
    return (
      <button
        type="button"
        className="icon-btn pp-unlink is-locked"
        aria-label={`${displayName(p)} can't be unlinked while they share children`}
        data-tip="Linked through their children"
        onClick={() =>
          toast(
            `${shortName(person)} and ${shortName(p)} are both parents of ${
              shared.length === 1 ? shortName(shared[0]) : `${shared.length} children`
            }. Remove that parent link first - or mark them as divorced.`,
          )
        }
      >
        <Lock size={11} />
      </button>
    );
  };

  const partnerNode = ({ person: p, union }: { person: Person; union: Union }) =>
    node(p, 'partner', partnerAction(p, union));

  // Former partners to the left of them, the latest to the right: each joined by its own link.
  const before = partners.slice(0, Math.max(0, partners.length - 1));
  const after = partners.slice(before.length);

  const self = (
    <div className="pp-node is-self" data-role="self">
      <span className="pp-anchor">
        <Avatar person={person} size={36} />
      </span>
      <span className="pp-node-name">{shortName(person)}</span>
      <span className="pp-node-sub">{lifespan(person) || ' '}</span>
    </div>
  );

  /* ---- Life line ----------------------------------------------------------------- */

  const lifeline = (() => {
    const start = yearFrac(person.birthDate);
    const now = new Date();
    const today = now.getFullYear() + now.getMonth() / 12 + (now.getDate() - 1) / 365;
    const end = person.deceased ? yearFrac(person.deathDate) : today;
    const span = start !== null && end !== null && end > start ? end - start : 0;
    const marks =
      span && start !== null
        ? children.flatMap((c) => {
            const t = yearFrac(c.birthDate);
            if (t === null) return [];
            return [{ child: c, x: Math.min(1, Math.max(0, (t - start) / span)), aged: Math.floor(t - start) }];
          })
        : [];

    const born = formatDate(person.birthDate);
    const left = born || person.birthPlace ? { value: born || person.birthPlace, sub: born ? person.birthPlace : '' } : null;
    const middle = children.length
      ? {
          value: `${children.length} ${children.length === 1 ? 'child' : 'children'}`,
          sub: descendants > children.length ? `${descendants} descendants` : yearSpan(children),
        }
      : null;
    const right = person.deceased
      ? { value: `Died ${formatDate(person.deathDate) || 'date unknown'}`, sub: age !== null ? `aged ${age}` : '' }
      : age !== null
        ? { value: `${age} ${age === 1 ? 'year' : 'years'}`, sub: '' }
        : null;
    if (!span && !left && !middle && !right) return null;

    const cell = (c: { value: string; sub: string } | null, align: string) => (
      <div className={`pp-life-cell is-${align}`}>
        {c && (
          <>
            <span className="pp-life-value">{c.value}</span>
            {c.sub && <span className="pp-life-sub">{c.sub}</span>}
          </>
        )}
      </div>
    );

    return (
      <div className={`pp-life${person.deceased ? ' is-past' : ''}`}>
        {span > 0 && (
          <div className="pp-life-bar" role="img" aria-label={`Life from ${born}${person.deceased ? '' : ' to today'}`}>
            <span className="pp-life-track" />
            <span className="pp-life-end is-start" />
            <span className="pp-life-end is-finish" />
            {marks.map(({ child, x, aged }) => (
              <button
                key={child.id}
                type="button"
                className={`pp-life-mark g-${child.gender}${x < 0.25 ? ' tip-start' : x > 0.75 ? ' tip-end' : ''}`}
                style={{ left: `${x * 100}%` }}
                aria-label={`${displayName(child)}, born ${yearOf(child.birthDate)}`}
                data-tip={`${shortName(child)}, ${yearOf(child.birthDate)} - when ${shortName(person)} was ${aged}`}
                onClick={() => select(child.id, true)}
              />
            ))}
          </div>
        )}
        <div className="pp-life-facts">
          {cell(left, 'start')}
          {cell(middle, 'middle')}
          {cell(right, 'end')}
        </div>
      </div>
    );
  })();

  /* ---- Header ------------------------------------------------------------------ */

  const photo = person.photo ? (
    <span className="photo-wrap">
      <button
        type="button"
        className="photo-view"
        onClick={() => viewPhoto(person.id)}
        aria-label="View full photo"
        data-tip="View full photo (P)"
      >
        <Avatar person={person} size={84} />
        <span className="photo-view-icon" aria-hidden="true">
          <Expand size={18} />
        </span>
      </button>
      <button
        type="button"
        className="photo-badge"
        onClick={() => pickPhotoFor(person.id)}
        aria-label="Change photo"
        data-tip="Change photo"
      >
        <Camera size={13} />
      </button>
    </span>
  ) : (
    <button
      type="button"
      className="photo-btn"
      onClick={() => pickPhotoFor(person.id)}
      aria-label="Add photo"
      data-tip="Add a photo - or drop one here"
    >
      <Avatar person={person} size={84} />
      <span className="photo-badge">
        <Camera size={13} />
      </span>
    </button>
  );

  return (
    <aside
      className={`panel${isFolded('compact') ? ' is-compact' : ''}`}
      aria-label={`Details for ${displayName(person)}`}
      data-person-id={person.id}
    >
      <header className="pp-head">
        <button
          type="button"
          className="icon-btn pp-close"
          onClick={() => select(null)}
          aria-label="Close details"
          data-tip="Close (Esc)"
        >
          <X size={18} />
        </button>

        {photo}

        <div className="pp-id">
          <h2 className="pp-name">{displayName(person)}</h2>
          {birthName && <span className="pp-aka">{birthName}</span>}
          {(relation || side) && (
            <div className="pp-meta">
              {relation && (
                <span className={`pp-rel${isHome ? ' is-home' : ''}`} data-tip={meaning || undefined}>
                  {isHome && <House size={13} strokeWidth={2.4} />}
                  {relation}
                </span>
              )}
              {side && (
                <button
                  type="button"
                  className={`pp-side${sideActive ? ' is-active' : ''}`}
                  data-tone={side.tone}
                  disabled={!side.focus}
                  aria-pressed={side.focus ? sideActive : undefined}
                  data-tip={side.focus ? (sideActive ? 'Show everyone again' : `Show only ${side.title}`) : undefined}
                  onClick={() => {
                    if (!side.focus) return;
                    if (sideActive) clearFocus();
                    else focusOn(side.focus.id, side.focus.scope);
                  }}
                >
                  <span className="side-swatch" data-tone={side.tone} aria-hidden="true" />
                  {side.title}
                </button>
              )}
            </div>
          )}
          {via.length > 0 && (
            <nav className="pp-via" aria-label="How you're connected">
              <span className="pp-via-label">via</span>
              {via.map((id, i) => (
                <span key={id} className="pp-via-step">
                  {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
                  <button type="button" onClick={() => select(id, true)}>
                    {shortName(tree.people[id])}
                  </button>
                </span>
              ))}
            </nav>
          )}
        </div>
      </header>

      <div className="pp-body" ref={bodyRef}>
        {lifeline}

        {placeholder && (
          <button type="button" className="hint hint-action" onClick={() => openDialog({ type: 'edit', personId: person.id })}>
            <Pencil size={15} />
            <span>
              This is a placeholder that keeps siblings linked. <strong>Fill in what you know</strong> - even just a
              name.
            </span>
          </button>
        )}

        {person.notes && (
          <p
            className={`pp-notes${isFolded('notes') ? ' is-clamped' : ''}`}
            title={notesClamped ? person.notes : undefined}
          >
            {person.notes}
          </p>
        )}

        <section className="pp-family" aria-label="Family">
          {/* FAMILY shares its line with [Line 13 | Close 14 | Family 25]: how much of the
              tree to keep around this person, and how many people each keeps. Pressing the
              active one again shows everyone. */}
          <div className="pp-family-head">
            <h3>Family</h3>
            {scopes.length > 0 && (
              <div className="segmented focus-options" role="group" aria-label="Show only">
                {scopes.map(({ scope, label, tip: why, key, size }) => {
                  const on = focusedScope === scope;
                  const count = `${size} ${size === 1 ? 'person' : 'people'}`;
                  return (
                    <button
                      key={scope}
                      type="button"
                      className="focus-option"
                      aria-pressed={on}
                      aria-label={`Show only ${label.toLowerCase()}, ${count}`}
                      data-tip={on ? 'Show everyone again (B)' : `Show only ${why}${key ? ` (${key})` : ''}`}
                      onClick={() => (on ? clearFocus() : focusOn(person.id, scope))}
                    >
                      {label}
                      <span className="focus-option-count">{size}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Three generations, one line each: parents; siblings, them and their partners;
              children. The lines between are measured off the nodes and drawn behind them. */}
          <div className="pp-tree" ref={treeRef} role="group" aria-label="Family tree">
            <svg className="pp-tree-lines" aria-hidden="true">
              <path d={lines} />
            </svg>

            {parents.length > 0 && (
              <div className="pp-gen is-up">
                {parents.map((p) =>
                  node(
                    p,
                    'parent',
                    unlinkButton(`Remove ${displayName(p)} as parent`, () => {
                      commit(unlinkParent(tree, person.id, p.id));
                      withUndo(`${shortName(p)} is no longer linked as a parent`);
                    }),
                  ),
                )}
              </div>
            )}

            <div className="pp-gen is-mid">
              {siblings.length > 0 &&
                (isFolded('sibling')
                  ? stack(siblings, 'sibling', partners.length ? 4 : 7, isFolded('siblingTight'))
                  : siblings.map((p) => node(p, 'sibling')))}
              {before.map((pt) => [partnerNode(pt), link(pt.person, pt.union)])}
              {self}
              {after.map((pt) => [link(pt.person, pt.union), partnerNode(pt)])}
            </div>

            {children.length > 0 && (
              <div className="pp-gen is-down">
                {isFolded('child')
                  ? stack(children, 'child', 11)
                  : children.map((p) =>
                      node(
                        p,
                        'child',
                        unlinkButton(`Remove ${displayName(p)} as child`, () => {
                          commit(unlinkParent(tree, p.id, person.id));
                          withUndo(`${shortName(p)} is no longer linked as a child`);
                        }),
                      ),
                    )}
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="pp-foot">
        <button
          type="button"
          className="btn"
          data-tip="Edit (Enter)"
          onClick={() => openDialog({ type: 'edit', personId: person.id })}
        >
          <Pencil size={15} /> Edit
        </button>
        <AddMenu
          options={ADD.filter(({ relation: r }) => r !== 'parent' || !parentsFull).map((o) =>
            o.relation === 'parent' && placeholderParent ? { ...o, label: 'Parent (fill in placeholder)' } : o,
          )}
          onPick={(r) => addRelative(r, person.id)}
        />
        {!isHome && (
          <button
            type="button"
            className="btn pp-me"
            aria-label="This is me"
            data-tip="This is me"
            onClick={() => {
              commit({ ...tree, homeId: person.id });
              withUndo(`Relationships now shown relative to ${shortName(person)}`);
            }}
          >
            <House size={15} />
          </button>
        )}
        <LinksMenu person={person} />
        <button
          type="button"
          className="btn btn-danger-ghost"
          onClick={() => openDialog({ type: 'delete', personId: person.id })}
          aria-label="Delete person"
          data-tip="Delete (Del)"
        >
          <Trash size={15} />
        </button>
      </footer>
    </aside>
  );
}

/**
 * The connecting lines, as one SVG path measured off the rendered nodes: parents joined
 * to each other, a drop from them to a bar over their children (the siblings and this
 * person), and the same from the couple down to their own children.
 */
function treeLines(root: HTMLElement): string {
  const frame = root.getBoundingClientRect();
  const box = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    const left = r.left - frame.left;
    const top = r.top - frame.top;
    return { x: left + r.width / 2, cy: top + r.height / 2, top, bottom: top + r.height, left, right: left + r.width };
  };
  const anchors = (sel: string) => [...root.querySelectorAll(`${sel} .pp-anchor`)].map(box).sort((a, b) => a.x - b.x);
  const px = (n: number) => Math.round(n * 2) / 2;
  let d = '';

  const bar = (from: { x: number; y: number }, to: Box[]) => {
    if (!to.length) return;
    const y = Math.min(...to.map((a) => a.top)) - 11;
    const xs = to.map((a) => a.x);
    d += `M${px(from.x)} ${px(from.y)}V${px(y)}`;
    d += `M${px(Math.min(from.x, ...xs))} ${px(y)}H${px(Math.max(from.x, ...xs))}`;
    for (const a of to) d += `M${px(a.x)} ${px(y)}V${px(a.top - 2)}`;
  };

  const ups = anchors('.pp-gen.is-up > .pp-node');
  const kids = anchors('.pp-gen.is-mid > .pp-node:is([data-role="sibling"], [data-role="self"])');
  if (ups.length >= 2) {
    const [a, b] = ups;
    d += `M${px(a.right + 4)} ${px(a.cy)}H${px(b.left - 4)}`;
    bar({ x: (a.right + b.left) / 2, y: a.cy }, kids);
  } else if (ups.length === 1) {
    const only = root.querySelector('.pp-gen.is-up > .pp-node');
    bar({ x: ups[0].x, y: only ? box(only).bottom + 2 : ups[0].bottom }, kids);
  }

  const children = anchors('.pp-gen.is-down > .pp-node');
  if (children.length) {
    // From the middle of the link to their partner when there's exactly one, else from below them.
    const links = root.querySelectorAll('.pp-link-line');
    const self = root.querySelector('.pp-node.is-self');
    if (links.length === 1) {
      const l = box(links[0]);
      bar({ x: l.x, y: l.cy }, children);
    } else if (self) {
      const s = box(self);
      bar({ x: s.x, y: s.bottom + 2 }, children);
    }
  }
  return d;
}

/** "+ Add" in the footer: a parent, partner, sibling or child, opening upwards. */
function AddMenu({ options, onPick }: { options: AddOption[]; onPick: (relation: Relation) => void }) {
  return (
    <FootMenu
      className="pp-add-btn"
      label="Add a relative"
      tip="Add a relative"
      button={
        <>
          <Plus size={15} /> Add <ChevronDown size={14} className="pp-add-chevron" />
        </>
      }
      popClass="pp-add-pop"
    >
      {(close) =>
        options.map(({ relation, label, icon }) => (
          <button
            key={relation}
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close();
              onPick(relation);
            }}
          >
            {icon}
            {label}
          </button>
        ))
      }
    </FootMenu>
  );
}

interface LinkRow {
  key: string;
  person: Person;
  role: string;
  /** Why it can't be removed from here, or '' */
  locked: string;
  remove: () => void;
  /** What removing it does, when that's more than the link itself */
  tip?: string;
}

const byGender = (p: Person, male: string, female: string, other: string) =>
  p.gender === 'male' ? male : p.gender === 'female' ? female : other;

/** Every link this person has to someone else, as rows that each remove one. */
function linkRows(tree: Tree, person: Person, done: (message: string, next: Tree) => void): LinkRow[] {
  const rows: LinkRow[] = [];
  for (const p of parentsOf(tree, person.id).sort(compareByBirth)) {
    rows.push({
      key: `parent:${p.id}`,
      person: p,
      role: byGender(p, 'Father', 'Mother', 'Parent'),
      locked: '',
      remove: () => done(`${shortName(p)} is no longer linked as a parent`, unlinkParent(tree, person.id, p.id)),
    });
  }
  for (const { person: p, union } of partnersOf(tree, person.id)) {
    const shared = sharedChildren(tree, person.id, p.id);
    const role = byGender(p, 'Husband', 'Wife', 'Partner');
    rows.push({
      key: `partner:${p.id}`,
      person: p,
      role: union.status === 'divorced' ? `Ex-${role.toLowerCase()}` : role,
      locked: shared.length
        ? `Parents of ${shared.length === 1 ? shortName(shared[0]) : `${shared.length} children`} together`
        : '',
      remove: () => done(`${shortName(p)} is no longer linked as a partner`, removeUnion(tree, union.id)),
    });
  }
  for (const s of siblingsOf(tree, person.id).sort(compareByBirth)) {
    const sharedParents = s.parentIds.filter((id) => person.parentIds.includes(id) && tree.people[id]);
    rows.push({
      key: `sibling:${s.id}`,
      person: s,
      role: byGender(s, 'Brother', 'Sister', 'Sibling'),
      locked: '',
      tip: `Also unlinks ${shortName(s)} from ${sharedParents.map((id) => shortName(tree.people[id])).join(' and ')}`,
      remove: () =>
        done(
          `${shortName(s)} is no longer linked as a sibling`,
          sharedParents.reduce((t, id) => unlinkParent(t, s.id, id), tree),
        ),
    });
  }
  for (const c of childrenOf(tree, person.id).sort(compareByBirth)) {
    rows.push({
      key: `child:${c.id}`,
      person: c,
      role: byGender(c, 'Son', 'Daughter', 'Child'),
      locked: '',
      remove: () => done(`${shortName(c)} is no longer linked as a child`, unlinkParent(tree, c.id, person.id)),
    });
  }
  return rows;
}

/** The unlink button in the footer: every link this person has, each one removable. */
function LinksMenu({ person }: { person: Person }) {
  const tree = useStore((s) => s.tree);
  const { commit, toast, undo } = useStore.getState();
  const rows = linkRows(tree, person, (message, next) => {
    commit(next);
    toast(message, { action: { label: 'Undo', run: undo } });
  });
  if (!rows.length) return null;
  return (
    <FootMenu
      className="pp-links-btn"
      wrapClass="pp-links"
      label={`Remove one of ${shortName(person)}'s links`}
      tip="Remove a link"
      button={<Unlink size={15} />}
      popClass="pp-links-pop"
    >
      {(close) => (
        <>
          <h3 className="pp-links-title">Remove a link</h3>
          <div className="pp-links-list">
            {rows.map((row) => (
              <button
                key={row.key}
                type="button"
                role="menuitem"
                className="menu-item pp-link-row"
                disabled={Boolean(row.locked)}
                title={row.locked || row.tip || undefined}
                onClick={() => {
                  close();
                  row.remove();
                }}
              >
                <Avatar person={row.person} size={28} />
                <span className="pp-link-row-text">
                  <span className="pp-link-row-name">{displayName(row.person)}</span>
                  <span className="pp-link-row-role">{row.locked || row.role}</span>
                </span>
                {row.locked ? <Lock size={13} /> : <Unlink size={14} className="pp-link-row-icon" />}
              </button>
            ))}
          </div>
        </>
      )}
    </FootMenu>
  );
}

/** A footer button with a menu that opens upwards from it. */
function FootMenu({
  className,
  wrapClass,
  label,
  tip,
  button,
  popClass,
  children,
}: {
  className: string;
  wrapClass?: string;
  label: string;
  tip: string;
  button: ReactNode;
  popClass: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close the menu, not the panel behind it.
        e.stopPropagation();
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>('.btn')?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className={`menu${wrapClass ? ` ${wrapClass}` : ''}`} ref={ref}>
      <button
        type="button"
        className={`btn ${className}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-tip={open ? undefined : tip}
        onClick={() => setOpen((o) => !o)}
      >
        {button}
      </button>
      {open && (
        <div className={`menu-pop ${popClass}`} role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
