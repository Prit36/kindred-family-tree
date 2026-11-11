import { Fragment, type ReactNode } from 'react';
import {
  Camera,
  ChevronRight,
  Expand,
  Focus,
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

const ADD_LABELS: Record<Relation, string> = {
  parent: 'parent',
  partner: 'partner',
  sibling: 'sibling',
  child: 'child',
};

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
              data-tip="Add a photo — or drop one here"
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
            {relation && (
              <span className={`chip${isHome ? ' chip-home' : ''}`}>
                {isHome && <House size={12} strokeWidth={2.4} />}
                {relation}
              </span>
            )}
          </div>
        </header>

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

        <section className="panel-section">
          <div className="panel-section-head">
            <h3>Family</h3>
            {(focused || branchSize < total) && (
              <button
                type="button"
                className={`btn focus-btn${focused ? ' is-active' : ''}`}
                aria-pressed={focused}
                data-tip={focused ? 'Bring back the whole tree (B)' : 'Hide everyone outside this branch (B)'}
                onClick={() => (focused ? clearFocus() : focusOn(person.id))}
              >
                <Focus size={15} />
                {focused ? 'Show all' : 'Focus branch'}
                <span className="focus-btn-count">
                  {branchSize} of {total}
                </span>
              </button>
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

        {hasFamily && (
          <p className="panel-tip">
            <kbd>Shift</kbd>+click a card to see how they relate to {shortName(person)}
          </p>
        )}
      </div>
    </aside>
  );
}
