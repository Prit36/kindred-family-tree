import { memo } from 'react';
import { House, Plus } from 'lucide-react';
import type { Person, Relation } from '../types';
import { lifespan } from '../lib/dates';
import { displayName } from '../lib/tree';
import { Avatar } from './Avatar';

interface Props {
  person: Person;
  x: number;
  y: number;
  selected: boolean;
  isHome: boolean;
  relation: string;
  canAddParent: boolean;
  onSelect: (id: string) => void;
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
  isHome,
  relation,
  canAddParent,
  onSelect,
  onAdd,
}: Props) {
  const name = displayName(person);
  const life = lifespan(person);
  const showRelation = relation && !isHome;

  return (
    <div className={`card-slot${selected ? ' is-selected' : ''}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
      <div
        className={`card g-${person.gender}${selected ? ' is-selected' : ''}${person.deceased ? ' is-deceased' : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${name}${showRelation ? `, ${relation}` : ''}`}
        onClick={() => onSelect(person.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
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
        </div>
        {isHome && (
          <span className="card-home" title="Relationships are shown relative to this person">
            <House size={11} strokeWidth={2.4} />
          </span>
        )}
      </div>

      {selected &&
        QUICK_ADD.filter((q) => q.relation !== 'parent' || canAddParent).map((q) => (
          <button
            key={q.relation}
            type="button"
            className={`quick-add quick-add-${q.side}`}
            data-no-export=""
            data-tip={q.label}
            aria-label={q.label}
            onClick={(e) => {
              e.stopPropagation();
              onAdd(q.relation, person.id);
            }}
          >
            <Plus size={14} strokeWidth={2.6} />
          </button>
        ))}
    </div>
  );
});
