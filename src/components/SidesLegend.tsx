import { useEffect, useState, type CSSProperties } from 'react';
import { ChevronRight, Users, X } from 'lucide-react';
import { useStore } from '../store';
import { sameFocus } from '../lib/branches';
import { familySides, type FamilySide } from '../lib/sides';
import { relationLabels } from '../lib/naming';

const countPeople = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * The sides of the family (lib/sides.ts), each in the colour its cards are tinted with.
 * Resting on a side lights it up on the tree; clicking it shows that side on its own.
 * Families that married into a side are tucked under it.
 */
export function SidesLegend() {
  const tree = useStore((s) => s.tree);
  const focus = useStore((s) => s.focus);
  const prefs = useStore((s) => s.sides);
  const naming = useStore((s) => s.naming);
  const kin = relationLabels(tree, naming);
  // A married-in family's subtitle is how its root is related to you, named as everywhere else.
  const subtitleOf = (side: FamilySide) =>
    (side.subtitleIsRelation && side.rootId && kin.get(side.rootId)) || side.subtitle;
  const { focusOn, clearFocus, setPeek, setSides } = useStore.getState();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const { sides } = familySides(tree);
  // With only close family (or no home person) there's nothing to tell apart.
  const useful = sides.length >= 2;

  // Whatever was being previewed stops when the list goes away.
  useEffect(() => {
    if (!prefs.open || !useful) setPeek(null);
  }, [prefs.open, useful, setPeek]);
  useEffect(() => () => setPeek(null), [setPeek]);

  if (!useful) return null;

  const nestedCount = new Map<string, number>();
  for (const side of sides) {
    if (side.parentKey) nestedCount.set(side.parentKey, (nestedCount.get(side.parentKey) ?? 0) + 1);
  }
  const byKey = new Map(sides.map((s) => [s.key, s]));
  const active = sides.find((s) => s.focus && sameFocus(s.focus, focus));
  // A nested family is listed while every side above it is expanded - or while it's the one on show.
  const shown = (side: FamilySide): boolean => {
    for (let up = side.parentKey; up; up = byKey.get(up)?.parentKey ?? null) {
      if (!expanded.has(up) && !(active && isUnder(active, up))) return false;
    }
    return true;
  };
  const isUnder = (side: FamilySide, ancestorKey: string): boolean => {
    for (let up = side.parentKey; up; up = byKey.get(up)?.parentKey ?? null) if (up === ancestorKey) return true;
    return false;
  };

  const toggleExpanded = (key: string) => {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    setExpanded(next);
  };

  return (
    <>
      <div className="control-group">
        <button
          type="button"
          className={`icon-btn sides-toggle${prefs.open ? ' is-active' : ''}`}
          aria-expanded={prefs.open}
          aria-controls="sides-list"
          onClick={() => setSides({ open: !prefs.open })}
          data-tip={prefs.open ? 'Hide the sides of the family' : 'Sides of the family'}
        >
          <Users size={15} />
          Sides
        </button>
      </div>

      {prefs.open && (
        <section id="sides-list" className="sides" aria-label="Sides of the family">
          <header className="sides-head">
            <h3>Sides of the family</h3>
            <label className="sides-colour" data-tip="Tint each card with its side's colour">
              <input type="checkbox" checked={prefs.colour} onChange={(e) => setSides({ colour: e.target.checked })} />
              Colours
            </label>
            <button
              type="button"
              className="icon-btn sides-close"
              aria-label="Close the list of sides"
              onClick={() => setSides({ open: false })}
            >
              <X size={15} />
            </button>
          </header>

          <ul className="sides-list" onMouseLeave={() => setPeek(null)}>
            {sides.filter(shown).map((side) => {
              const isActive = side === active;
              const nested = nestedCount.get(side.key) ?? 0;
              const open = expanded.has(side.key) || Boolean(active && isUnder(active, side.key));
              const peekOn = () => setPeek(side.focus);
              return (
                <li key={side.key} className="side-row" style={{ '--depth': side.depth } as CSSProperties}>
                  <button
                    type="button"
                    className={`side-main${isActive ? ' is-active' : ''}`}
                    aria-pressed={side.focus ? isActive : undefined}
                    disabled={!side.focus}
                    onMouseEnter={peekOn}
                    onFocus={peekOn}
                    onBlur={() => setPeek(null)}
                    onClick={() => {
                      if (!side.focus) return;
                      setPeek(null);
                      if (isActive) clearFocus();
                      else focusOn(side.focus.id, side.focus.scope);
                    }}
                  >
                    <span className="side-swatch" data-tone={side.tone} aria-hidden="true" />
                    <span className="side-text" title={[side.title, subtitleOf(side)].filter(Boolean).join(' · ')}>
                      <span className="side-title">{side.title}</span>
                      {subtitleOf(side) && <span className="side-sub">{subtitleOf(side)}</span>}
                    </span>
                    <span className="side-count" aria-label={countPeople(side.members.length)}>
                      {side.members.length}
                    </span>
                  </button>
                  {nested > 0 && (
                    <button
                      type="button"
                      className={`icon-btn side-expand${open ? ' is-open' : ''}`}
                      aria-expanded={open}
                      aria-label={`${open ? 'Hide' : 'Show'} the ${nested} ${nested === 1 ? 'family' : 'families'} that married into ${side.title}`}
                      data-tip={`${nested} married-in ${nested === 1 ? 'family' : 'families'}`}
                      onClick={() => toggleExpanded(side.key)}
                    >
                      <ChevronRight size={14} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
