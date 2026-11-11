import { memo, type CSSProperties } from 'react';
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
  /** Colour of their side of the family (see lib/sides.ts), or null for none */
  tone: number | null;
  /** Faded while another part of the tree is being previewed */
  dimmed: boolean;
  /** Joined by the connector line being rested on */
  linked: boolean;
  canAddParent: boolean;
  onSelect: (id: string) => void;
  onCompare: (id: string) => void;
  onEdit: (id: string) => void;
  onAdd: (relation: Relation, id: string) => void;
}

/** Width the glance label has to fit in, and the largest it is drawn (world pixels). */
const GLANCE_W = 196;
const GLANCE_MAX = 36;

/**
 * The relationship as shown when zoomed out. The side colour already says paternal or
 * maternal, so that part goes.
 */
function glanceLabel(relation: string): string {
  return relation.replace(/^(Paternal|Maternal) (\w)/, (_, _side, c: string) => c.toUpperCase());
}

const GUJARATI = /[઀-૿]/;
const graphemes = new Intl.Segmenter();

/** How many Latin letters wide the text is, roughly: a Gujarati syllable (કા) takes about one and a half. */
function widthOf(text: string): number {
  if (!GUJARATI.test(text)) return text.length;
  let n = 0;
  for (const { segment } of graphemes.segment(text)) n += GUJARATI.test(segment) ? 1.5 : 1;
  return n;
}

/** A font size that lets the text fill the card's width without overflowing it. */
const fitFont = (text: string, ratio: number) => Math.min(GLANCE_MAX, Math.floor(GLANCE_W / Math.max(1, widthOf(text) * ratio)));

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
  tone,
  dimmed,
  linked,
  canAddParent,
  onSelect,
  onCompare,
  onEdit,
  onAdd,
}: Props) {
  const name = displayName(person);
  const life = lifespan(person);
  // The home person's relation is what they're called: "You", or "તમે" in Gujarati.
  const glance = isHome ? relation || 'You' : glanceLabel(relation);
  const first = person.firstName.trim() || name;

  const cls = [
    'card',
    `g-${person.gender}`,
    selected && 'is-selected',
    compared && 'is-compared',
    onPath && 'is-on-path',
    person.deceased && 'is-deceased',
    placeholder && 'is-placeholder',
    dimmed && 'is-dimmed',
    linked && 'is-linked',
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
        data-tone={tone ?? undefined}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${name}${relation ? `, ${relation}` : ''}`}
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
          {(relation || isHome) && <div className="card-relation">{relation || 'You'}</div>}
          {life && <div className="card-life">{life}</div>}
        </div>
        {isHome && (
          <span className="card-home" title="Relationships are shown relative to this person">
            <House size={11} strokeWidth={2.4} />
          </span>
        )}
        {/* Shown instead of the above when zoomed far out (see FAR_ZOOM in Canvas). */}
        <div className="card-glance" aria-hidden="true">
          {glance ? (
            <>
              <span className="glance-relation" style={{ '--fit': `${fitFont(glance, 0.56)}px` } as CSSProperties}>
                {glance}
              </span>
              <span className="glance-name" style={{ '--fit': `${fitFont(first, 0.6) * 0.78}px` } as CSSProperties}>
                {first}
              </span>
            </>
          ) : (
            <span className="glance-relation" style={{ '--fit': `${fitFont(first, 0.6)}px` } as CSSProperties}>
              {first}
            </span>
          )}
        </div>
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
