import { Fragment, type ReactNode } from 'react';
import {
  Baby,
  Camera,
  ChevronRight,
  Focus,
  Heart,
  House,
  Lock,
  Pencil,
  Trash,
  Unlink,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import type { Person, Relation, UnionStatus } from '../types';
import { useStore } from '../store';
import { addRelative, pickPhotoFor } from '../lib/actions';
import { branchOf } from '../lib/branches';
import { ageOf, compareByBirth, formatDate, lifespan } from '../lib/dates';
import { kinshipFor } from '../lib/kinship';
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

const ADD_BUTTONS: { relation: Relation; label: string; icon: ReactNode }[] = [
  { relation: 'parent', label: 'Parent', icon: <UserRound size={16} /> },
  { relation: 'partner', label: 'Partner', icon: <Heart size={16} /> },
  { relation: 'sibling', label: 'Sibling', icon: <Users size={16} /> },
  { relation: 'child', label: 'Child', icon: <Baby size={16} /> },
];

export function PersonPanel() {
  const tree = useStore((s) => s.tree);
  const selectedId = useStore((s) => s.selectedId);
  const focusId = useStore((s) => s.focusId);
  const { select, commit, openDialog, toast, undo, focusOn, clearFocus } = useStore.getState();

  const person = selectedId ? tree.people[selectedId] : undefined;
  if (!person) return null;

  const kin = kinshipFor(tree);
  const isHome = tree.homeId === person.id;
  const relation = isHome ? 'You' : kin.get(person.id);
  const age = ageOf(person);
  const placeholder = isPlaceholder(person);

  const parents = parentsOf(tree, person.id);
  const partners = partnersOf(tree, person.id);
  const siblings = siblingsOf(tree, person.id).sort(compareByBirth);
  const children = childrenOf(tree, person.id).sort(compareByBirth);
  const hasFamily = parents.length + partners.length + siblings.length + children.length > 0;

  const born = [formatDate(person.birthDate), person.birthPlace].filter(Boolean).join(' · ');
  const died = person.deceased ? formatDate(person.deathDate) || 'Deceased' : '';
  const birthName =
    person.birthName && person.birthName !== person.lastName
      ? `${person.gender === 'male' ? 'né' : person.gender === 'female' ? 'née' : 'born'} ${person.birthName}`
      : '';

  // The people in between explain a label like "Cousin once removed" better than the label does.
  const chain = !isHome && tree.homeId ? pathBetween(tree, tree.homeId, person.id) : null;
  const showChain = chain !== null && chain.length > 2;

  // Focusing only earns its place when it would actually clear people out of the way.
  const total = Object.keys(tree.people).length;
  const branchSize = branchOf(tree, person.id).size;
  const focused = focusId === person.id;

  const parentSlotsFull = person.parentIds.length >= 2;
  const placeholderParent = parents.find(isPlaceholder);

  const withUndo = (message: string) => toast(message, { action: { label: 'Undo', run: undo } });

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
          <button
            type="button"
            className="photo-btn"
            onClick={() => pickPhotoFor(person.id)}
            aria-label={person.photo ? 'Change photo' : 'Add photo'}
            data-tip={person.photo ? 'Change photo' : 'Add a photo — or drop one here'}
          >
            <Avatar person={person} size={84} />
            <span className="photo-badge">
              <Camera size={13} />
            </span>
          </button>
          <h2 className="panel-name">{displayName(person)}</h2>
          {birthName && <span className="panel-aka">{birthName}</span>}
          {relation && (
            <span className={`chip${isHome ? ' chip-home' : ''}`}>
              {isHome && <House size={12} strokeWidth={2.4} />}
              {relation}
            </span>
          )}
          {showChain && (
            <nav className="chain" aria-label="How you're connected">
              {chain.map((id, i) => {
                const last = i === chain.length - 1;
                const label = i === 0 ? 'You' : shortName(tree.people[id]);
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
        </header>

        {placeholder && (
          <button type="button" className="hint hint-action" onClick={() => openDialog({ type: 'edit', personId: person.id })}>
            <Pencil size={15} />
            <span>
              This is a placeholder that keeps siblings linked. <strong>Fill in what you know</strong> — even just a
              name.
            </span>
          </button>
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

        {(focused || branchSize < total) && (
          <button
            type="button"
            className={`focus-btn${focused ? ' is-active' : ''}`}
            aria-pressed={focused}
            data-tip={focused ? 'Back to the whole tree (B)' : 'Hide everyone else (B)'}
            onClick={() => (focused ? clearFocus() : focusOn(person.id))}
          >
            <Focus size={17} />
            <span className="focus-btn-text">
              <span className="focus-btn-title">
                {focused ? `Showing only ${shortName(person)}'s branch` : `Focus on ${shortName(person)}'s branch`}
              </span>
              <span className="focus-btn-sub">
                {focused ? 'Click to bring back the whole tree' : 'Ancestors, descendants and close family'}
              </span>
            </span>
            <span className="focus-btn-count">
              {branchSize} of {total}
            </span>
          </button>
        )}

        <section className="panel-section">
          <h3>Add a relative</h3>
          <div className="add-grid">
            {ADD_BUTTONS.map((b) => {
              const isParent = b.relation === 'parent';
              const full = isParent && parentSlotsFull && !placeholderParent;
              const fills = isParent && parentSlotsFull && placeholderParent;
              return (
                <button
                  key={b.relation}
                  type="button"
                  className="add-btn"
                  disabled={full}
                  title={
                    full
                      ? 'Both parents are already in the tree'
                      : fills
                        ? 'Fill in the placeholder parent'
                        : undefined
                  }
                  onClick={() => addRelative(b.relation, person.id)}
                >
                  {b.icon}
                  {b.label}
                </button>
              );
            })}
          </div>
        </section>

        {hasFamily && (
          <section className="panel-section">
            <h3>Family</h3>

            {parents.length > 0 && (
              <>
                <h4>Parents</h4>
                <ul className="rel-list">
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

            {partners.length > 0 && (
              <>
                <h4>{partners.length > 1 ? 'Partners' : 'Partner'}</h4>
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
                                }. Remove that parent link first — or mark them as divorced.`,
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

            {siblings.length > 0 && (
              <>
                <h4>Siblings</h4>
                <ul className="rel-list">{siblings.map((p) => row(p))}</ul>
              </>
            )}

            {children.length > 0 && (
              <>
                <h4>Children</h4>
                <ul className="rel-list">
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
        )}

        {hasFamily && (
          <p className="panel-tip">
            <kbd>Shift</kbd>+click another card to see how they're related to {shortName(person)}.
          </p>
        )}
      </div>
    </aside>
  );
}
