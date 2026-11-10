import type { ReactNode } from 'react';
import { Baby, Heart, House, Pencil, Trash, Unlink, UserRound, Users, X } from 'lucide-react';
import type { Person, Relation, UnionStatus } from '../types';
import { useStore } from '../store';
import { ageOf, compareByBirth, formatDate, lifespan } from '../lib/dates';
import { kinshipFor } from '../lib/kinship';
import {
  childrenOf,
  displayName,
  parentsOf,
  partnersOf,
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
  const { select, commit, openDialog, toast, undo } = useStore.getState();

  const person = selectedId ? tree.people[selectedId] : undefined;
  if (!person) return null;

  const kin = kinshipFor(tree);
  const isHome = tree.homeId === person.id;
  const relation = isHome ? 'You' : kin.get(person.id);
  const age = ageOf(person);

  const parents = parentsOf(tree, person.id);
  const partners = partnersOf(tree, person.id);
  const siblings = siblingsOf(tree, person.id).sort(compareByBirth);
  const children = childrenOf(tree, person.id).sort(compareByBirth);
  const hasFamily = parents.length + partners.length + siblings.length + children.length > 0;

  const born = [formatDate(person.birthDate), person.birthPlace].filter(Boolean).join(' · ');
  const died = person.deceased ? formatDate(person.deathDate) || 'Deceased' : '';

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
    <aside className="panel" aria-label={`Details for ${displayName(person)}`}>
      <button type="button" className="icon-btn panel-close" onClick={() => select(null)} aria-label="Close details">
        <X size={18} />
      </button>

      <div className="panel-scroll">
        <header className="panel-head">
          <Avatar person={person} size={84} />
          <h2 className="panel-name">{displayName(person)}</h2>
          {relation && (
            <span className={`chip${isHome ? ' chip-home' : ''}`}>
              {isHome && <House size={12} strokeWidth={2.4} />}
              {relation}
            </span>
          )}
        </header>

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
          <button type="button" className="btn" onClick={() => openDialog({ type: 'edit', personId: person.id })}>
            <Pencil size={15} /> Edit
          </button>
          {!isHome && (
            <button
              type="button"
              className="btn"
              data-tip="Show everyone's relationship to this person"
              onClick={() => {
                commit({ ...tree, homeId: person.id });
                toast(`Relationships now shown relative to ${shortName(person)}`);
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
            data-tip="Delete"
          >
            <Trash size={15} />
          </button>
        </div>

        <section className="panel-section">
          <h3>Add a relative</h3>
          <div className="add-grid">
            {ADD_BUTTONS.map((b) => {
              const full = b.relation === 'parent' && person.parentIds.length >= 2;
              return (
                <button
                  key={b.relation}
                  type="button"
                  className="add-btn"
                  disabled={full}
                  title={full ? 'Both parents are already in the tree' : undefined}
                  onClick={() => openDialog({ type: 'add', relation: b.relation, anchorId: person.id })}
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
                    const locked = sharedChildren(tree, person.id, p.id).length > 0;
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
                        {!locked && (
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
                <ul className="rel-list">{children.map((p) => row(p))}</ul>
              </>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
