import { memo } from 'react';
import type { Tree } from '../types';
import { familyWords, lineIds, lineTitle } from '../lib/lines';
import { useStore } from '../store';
import { shortName } from '../lib/tree';

/** A family linked to the one on show by a marriage, and who on show leads there. */
export interface DeckCard {
  line: string;
  /** People on show with a bridge to it, left to right */
  via: string[];
}

interface ChipsProps {
  tree: Tree;
  cards: DeckCard[];
  onGo: (card: DeckCard) => void;
  /** The pointer (or focus) is on a family, so its threads are lit; null when it leaves. */
  onHot: (line: string | null) => void;
}

/**
 * The families linked by marriage to the one on show, as plain chips in the family bar:
 * name and size, and who leads there in the tip. Choosing one swaps the families (see
 * Canvas.tsx); resting on one lights its thread down to whoever leads there.
 */
export const FamilyChips = memo(function FamilyChips({ tree, cards, onGo, onHot }: ChipsProps) {
  const naming = useStore((s) => s.naming);
  if (cards.length === 0) return null;
  const words = familyWords(naming);
  return (
    <div className="family-chips" role="group" aria-label="Families linked by marriage">
      {cards.map((card) => {
        const title = lineTitle(tree, card.line, naming, card.via[0]);
        const size = lineIds(tree, card.line).size;
        const via = words.via(card.via.map((id) => shortName(tree.people[id])));
        return (
          <button
            key={card.line}
            type="button"
            className="family-chip"
            data-line={card.line}
            data-tip={`${via} · ${words.people(size)}`}
            aria-label={`${title}, ${words.people(size)}, ${via}`}
            onClick={() => onGo(card)}
            onPointerEnter={() => onHot(card.line)}
            onPointerLeave={() => onHot(null)}
            onFocus={() => onHot(card.line)}
            onBlur={() => onHot(null)}
          >
            <span className="family-chip-name">{title}</span>
            <span className="family-chip-count">{size}</span>
          </button>
        );
      })}
    </div>
  );
});
