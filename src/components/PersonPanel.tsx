import { Fragment, type ReactNode } from 'react';
import {
  Camera,
  ChevronRight,
  Expand,
  House,
  Lock,
  Pencil,
  Plus,
  Trash,
  Unlink,
  X,
} from 'lucide-react';
import type { Person, Relation, UnionStatus } from '../types';
import { useStore } from '../store';
import { addRelative, pickPhotoFor, viewPhoto } from '../lib/actions';
import { focusSet, sameFocus, type FocusScope } from '../lib/branches';
import { familySides } from '../lib/sides';
import { ageOf, compareByBirth, formatDate, lifespan } from '../lib/dates';
import { relationLabels, relationName, selfLabel } from '../lib/naming';
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

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id));

const ADD_LABELS: Record<Relation, string> = {
  parent: 'parent',
  partner: 'partner',
  sibling: 'sibling',
  child: 'child',
};

export function PersonPanel() {
  const tree = useStore((s) => s.tree);
  const selectedId = useStore((s) => s.selectedId);
  const focus = useStore((s) => s.focus);
  const naming = useStore((s) => s.naming);
  const { select, commit, openDialog, toast, undo, focusOn, clearFocus } = useStore.getState();

  const person = selectedId ? tree.people[selectedId] : undefined;
  if (!person) return null;

  const kin = relationLabels(tree, naming);
  const isHome = tree.homeId === person.id;
  const relation = kin.get(person.id);
  // A Gujarati name's meaning in English, on hover: "Father's younger brother".
  const meaning = !isHome && tree.homeId ? (relationName(tree, tree.homeId, person.id, naming)?.meaning ?? '') : '';
  const age = ageOf(person);
  const placeholder = isPlaceholder(person);

  const parents = parentsOf(tree, person.id);
  const partners = partnersOf(tree, person.id);
  const siblings = siblingsOf(tree, person.id).sort(compareByBirth);
  const children = childrenOf(tree, person.id).sort(compareByBirth);

  const born = [formatDate(person.birthDate), person.birthPlace].filter(Boolean).join(' · ');
  const died = person.deceased ? formatDate(person.deathDate) || 'Deceased' : '';
  const birthName =
    person.birthName && person.birthName !== person.lastName
      ? `${person.gender === 'male' ? 'né' : person.gender === 'female' ? 'née' : 'born'} ${person.birthName}`
      : '';

  // The people in between explain a label like "Cousin once removed" better than the label does.
  const chain = !isHome && tree.homeId ? pathBetween(tree, tree.homeId, person.id) : null;
  const showChain = chain !== null && chain.length > 2;

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

  const parentSlotsFull = person.parentIds.length >= 2;
  const placeholderParent = parents.find(isPlaceholder);

  const withUndo = (message: string) => toast(message, { action: { label: 'Undo', run: undo } });

  // Each family group's heading has its own "+ Add", so adding sits right where the new person will appear.
  const groupHead = (relation: Relation, title: string) => {
    const full = relation === 'parent' && parentSlotsFull && !placeholderParent;
    const fills = relation === 'parent' && parentSlotsFull && placeholderParent;
    return (
      <div className="rel-head">
        <h4>{title}</h4>
        {!full && (
          <button
            type="button"
            className="rel-add"
            data-tip={fills ? 'Fill in the placeholder parent' : `Add a ${ADD_LABELS[relation]}`}
            onClick={() => addRelative(relation, person.id)}
          >
            <Plus size={14} /> Add
          </button>
        )}
      </div>
    );
  };

  const row = (p: Person, extra?: ReactNode) => (
    <li key={p.id} className="rel-row">
      <button type="button" className="rel-main" onClick={() => select(p.id, true)}>
        <Avatar person={p} size={34} />
        <span className="rel-text">
          <span className="rel-name">{displayName(p)}</span>
          <span className="rel-sub">{[kin.get(p.id), lifespan(p)].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
      {extra}
    </li>
  );

  return (
    <aside className="panel" aria-label={`Details for ${displayName(person)}`} data-person-id={person.id}>
      <button
        type="button"
        className="icon-btn panel-close"
        onClick={() => select(null)}
        aria-label="Close details"
        data-tip="Close (Esc)"
      >
        <X size={18} />
      </button>

      <div className="panel-scroll">
        <header className="panel-head">
          {person.photo ? (
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
          )}
          <div className="panel-id">
            <h2 className="panel-name">{displayName(person)}</h2>
            {birthName && <span className="panel-aka">{birthName}</span>}
            {(relation || side) && (
              <div className="panel-chips">
                {relation && (
                  <span className={`chip${isHome ? ' chip-home' : ''}`} data-tip={meaning || undefined}>
                    {isHome && <House size={12} strokeWidth={2.4} />}
                    {relation}
                  </span>
                )}
                {side && (
                  <button
                    type="button"
                    className={`chip side-chip${sideActive ? ' is-active' : ''}`}
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
            {(born || died || age !== null) && (
              <dl className="facts">
                {born && (
                  <div>
                    <dt>Born</dt>
                    <dd>{born}</dd>
                  </div>
                )}
                {died && (
                  <div>
                    <dt>Died</dt>
                    <dd>{died}</dd>
                  </div>
                )}
                {age !== null && (
                  <div>
                    <dt>{person.deceased ? 'Lived' : 'Age'}</dt>
                    <dd>
                      {age} {age === 1 ? 'year' : 'years'}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </header>

        {showChain && (
          <nav className="chain" aria-label="How you're connected">
            {chain.map((id, i) => {
              const last = i === chain.length - 1;
              const label = i === 0 ? selfLabel(naming) : shortName(tree.people[id]);
              return (
                <Fragment key={id}>
                  {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
                  {last ? (
                    <span className="chain-here">{label}</span>
                  ) : (
                    <button type="button" className="chain-step" onClick={() => select(id, true)}>
                      {label}
                    </button>
                  )}
                </Fragment>
              );
            })}
          </nav>
        )}

        {placeholder && (
          <button type="button" className="hint hint-action" onClick={() => openDialog({ type: 'edit', personId: person.id })}>
            <Pencil size={15} />
            <span>
              This is a placeholder that keeps siblings linked. <strong>Fill in what you know</strong> - even just a
              name.
            </span>
          </button>
        )}

        {person.notes && <p className="panel-notes">{person.notes}</p>}

        <div className="panel-actions">
          <button
            type="button"
            className="btn"
            data-tip="Edit (Enter)"
            onClick={() => openDialog({ type: 'edit', personId: person.id })}
          >
            <Pencil size={15} /> Edit
          </button>
          {!isHome && (
            <button
              type="button"
              className="btn"
              data-tip="Show everyone's relationship to this person"
              onClick={() => {
                commit({ ...tree, homeId: person.id });
                withUndo(`Relationships now shown relative to ${shortName(person)}`);
              }}
            >
              <House size={15} /> This is me
            </button>
          )}
          <button
            type="button"
            className="btn btn-danger-ghost"
            onClick={() => openDialog({ type: 'delete', personId: person.id })}
            aria-label="Delete person"
            data-tip="Delete (Del)"
          >
            <Trash size={15} />
          </button>
        </div>

        <section className="panel-section">
          {/* The heading shares its line with [Line 13 | Close 14 | Family 25]: how much of the
              tree to keep around this person, and how many people each keeps. Pressing the
              active one again shows everyone. */}
          <div className="panel-section-head">
            <h3>Family</h3>
            {scopes.length > 0 && (
              <div className="segmented focus-options" role="group" aria-label="Show only">
                {scopes.map(({ scope, label, tip, key, size }) => {
                  const on = focusedScope === scope;
                  const count = `${size} ${size === 1 ? 'person' : 'people'}`;
                  return (
                    <button
                      key={scope}
                      type="button"
                      className="focus-option"
                      aria-pressed={on}
                      aria-label={`Show only ${label.toLowerCase()}, ${count}`}
                      data-tip={on ? 'Show everyone again (B)' : `Show only ${tip}${key ? ` (${key})` : ''}`}
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

          {groupHead('parent', 'Parents')}
          {parents.length > 0 && (
            <>
              <ul className="rel-list rel-grid">
                {parents.map((p) =>
                  row(
                    p,
                    <button
                      type="button"
                      className="icon-btn rel-action"
                      aria-label={`Remove ${displayName(p)} as parent`}
                      data-tip="Remove link"
                      onClick={() => {
                        commit(unlinkParent(tree, person.id, p.id));
                        withUndo(`${shortName(p)} is no longer linked as a parent`);
                      }}
                    >
                      <Unlink size={14} />
                    </button>,
                  ),
                )}
              </ul>
            </>
          )}

          {groupHead('partner', partners.length > 1 ? 'Partners' : 'Partner')}
          {partners.length > 0 && (
            <>
              <ul className="rel-list">
                {partners.map(({ person: p, union }) => {
                  const shared = sharedChildren(tree, person.id, p.id);
                  const locked = shared.length > 0;
                  return row(
                    p,
                    <>
                      <select
                        className="input status-select"
                        aria-label={`Relationship with ${displayName(p)}`}
                        value={union.status}
                        onChange={(e) => commit(setUnionStatus(tree, union.id, e.target.value as UnionStatus))}
                      >
                        <option value="married">Married</option>
                        <option value="partner">Partner</option>
                        <option value="divorced">Divorced</option>
                      </select>
                      {locked ? (
                        // Not hidden or dead: say why this couple can't be unlinked.
                        <button
                          type="button"
                          className="icon-btn rel-action is-locked"
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
                          <Lock size={13} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="icon-btn rel-action"
                          aria-label={`Remove ${displayName(p)} as partner`}
                          data-tip="Remove link"
                          onClick={() => {
                            commit(removeUnion(tree, union.id));
                            withUndo(`${shortName(p)} is no longer linked as a partner`);
                          }}
                        >
                          <Unlink size={14} />
                        </button>
                      )}
                    </>,
                  );
                })}
              </ul>
            </>
          )}

          {groupHead('sibling', 'Siblings')}
          {siblings.length > 0 && (
            <>
              <ul className="rel-list rel-grid">{siblings.map((p) => row(p))}</ul>
            </>
          )}

          {groupHead('child', 'Children')}
          {children.length > 0 && (
            <>
              <ul className="rel-list rel-grid">
                {children.map((p) =>
                  row(
                    p,
                    <button
                      type="button"
                      className="icon-btn rel-action"
                      aria-label={`Remove ${displayName(p)} as child`}
                      data-tip="Remove link"
                      onClick={() => {
                        commit(unlinkParent(tree, p.id, person.id));
                        withUndo(`${shortName(p)} is no longer linked as a child`);
                      }}
                    >
                      <Unlink size={14} />
                    </button>,
                  ),
                )}
              </ul>
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
