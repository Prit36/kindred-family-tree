import { memo } from 'react';
import { House, Plus, ScrollText } from 'lucide-react';
import type { Person, Relation } from '../types';
import { lifespan } from '../lib/dates';
import { displayName } from '../lib/tree';
import { Avatar } from './Avatar';

interface Props {
  person: Person;
  x: number;
  y: number;
  selected: boolean;
  /** The second person in a "how are these two related" comparison */
  compared: boolean;
  /** Part of the highlighted chain between the selected person and "me" */
  onPath: boolean;
  isHome: boolean;
  /** A blank stand-in parent that still needs filling in */
  placeholder: boolean;
  relation: string;
  canAddParent: boolean;
  onSelect: (id: string) => void;
  onCompare: (id: string) => void;
  onEdit: (id: string) => void;
  onAdd: (relation: Relation, id: string) => void;
}

const QUICK_ADD: { relation: Relation; side: string; label: string }[] = [
  { relation: 'parent', side: 'top', label: 'Add parent' },
  { relation: 'child', side: 'bottom', label: 'Add child' },
  { relation: 'sibling', side: 'left', label: 'Add sibling' },
  { relation: 'partner', side: 'right', label: 'Add partner' },
];

export const PersonCard = memo(function PersonCard({
  person,
  x,
  y,
  selected,
  compared,
  onPath,
  isHome,
  placeholder,
  relation,
  canAddParent,
  onSelect,
  onCompare,
  onEdit,
  onAdd,
}: Props) {
  const name = displayName(person);
  const life = lifespan(person);
  const showRelation = relation && !isHome;

  const cls = [
    'card',
    `g-${person.gender}`,
    selected && 'is-selected',
    compared && 'is-compared',
    onPath && 'is-on-path',
    person.deceased && 'is-deceased',
    placeholder && 'is-placeholder',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={`card-slot${selected ? ' is-selected' : ''}`}
      data-person-id={person.id}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <div
        className={cls}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${name}${showRelation ? `, ${relation}` : ''}`}
        onClick={(e) => (e.shiftKey ? onCompare(person.id) : onSelect(person.id))}
        onDoubleClick={() => onEdit(person.id)}
        onKeyDown={(e) => {
          if (e.key === ' ' || (e.key === 'Enter' && !selected)) {
            e.preventDefault();
            // Enter on the card that's already selected is left to the global "edit" shortcut.
            e.stopPropagation();
            onSelect(person.id);
          }
        }}
      >
        <Avatar person={person} size={52} />
        <div className="card-text">
          <div className="card-name" title={name}>
            {name}
          </div>
          {showRelation && <div className="card-relation">{relation}</div>}
          {isHome && <div className="card-relation">You</div>}
          {life && <div className="card-life">{life}</div>}
          {placeholder && (
            <div className="card-life" data-no-export="">
              Double-click to fill in
            </div>
          )}
        </div>
        {isHome && (
          <span className="card-home" title="Relationships are shown relative to this person">
            <House size={11} strokeWidth={2.4} />
          </span>
        )}
        {person.notes && (
          <span className="card-note" title="Has notes - select to read">
            <ScrollText size={13} />
          </span>
        )}
      </div>

      {selected &&
        QUICK_ADD.filter((q) => q.relation !== 'parent' || canAddParent).map((q) => {
          const label = q.relation === 'parent' && person.parentIds.length >= 2 ? 'Fill in parent' : q.label;
          return (
            <button
              key={q.relation}
              type="button"
              className={`quick-add quick-add-${q.side}`}
              data-no-export=""
              data-tip={label}
              aria-label={label}
              onClick={(e) => {
                e.stopPropagation();
                onAdd(q.relation, person.id);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <Plus size={14} strokeWidth={2.6} />
            </button>
          );
        })}
    </div>
  );
});
