import { forwardRef, useCallback, useRef, type CSSProperties, type ReactNode } from 'react';
import { Briefcase, Droplet, GraduationCap, Sparkle } from 'lucide-react';
import type { Person } from '../types';
import { RARITY_LABEL, type CardStats } from '../lib/cards';
import { yearOf } from '../lib/dates';
import { factsOf } from '../lib/facts';
import { initials, shortName, shown } from '../lib/tree';
import { CardBack, Filigree, Garland, LifeRings } from './CardArt';

export interface FamilyCardProps {
  person: Person;
  stats: CardStats;
  /** What they are to "me", in the chosen words - or '' */
  kin: string;
  /** What a Gujarati word means, under it */
  meaning?: string;
  /** Hide the relationship (Who's who? asks for it) */
  hideKin?: boolean;
  no?: number;
  total?: number;
  known?: boolean;
  home?: boolean;
  /** Showing the back */
  flipped?: boolean;
  back?: ReactNode;
  /** Leans towards the pointer, with the foil catching the light */
  tilt?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  label?: string;
}

const GLYPH = { legend: '★', rare: '◆', common: '●' } as const;

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/**
 * Pointer tilt: the card leans towards the pointer and the foil and glare follow it. Set
 * as CSS variables straight on the element, so moving the pointer never re-renders.
 */
export function useTilt(strength = 1) {
  const frame = useRef(0);
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch') return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
        el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
        el.style.setProperty('--rx', `${((0.5 - y) * 16 * strength).toFixed(2)}deg`);
        el.style.setProperty('--ry', `${((x - 0.5) * 20 * strength).toFixed(2)}deg`);
        el.style.setProperty('--hyp', Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 2).toFixed(3));
        el.dataset.tilting = '';
      });
    },
    [strength],
  );
  const onPointerLeave = useCallback((e: React.PointerEvent<HTMLElement>) => {
    cancelAnimationFrame(frame.current);
    const el = e.currentTarget;
    delete el.dataset.tilting;
    for (const v of ['--mx', '--my', '--rx', '--ry', '--hyp']) el.style.removeProperty(v);
  }, []);
  return { onPointerMove, onPointerLeave };
}

/** The age in the corner: years for the living, the years they lived for those gone. */
function Age({ person, stats }: { person: Person; stats: CardStats }) {
  const gone = person.deceased || Boolean(person.deathDate);
  if (stats.age === null) return <span className="fc-age is-unknown">?</span>;
  return (
    <span className={`fc-age${gone ? ' is-gone' : ''}`}>
      <b>{stats.age}</b>
      <small>{gone ? 'lived' : 'yrs'}</small>
    </span>
  );
}

/** The back every card shares (kept under its old name for the quiz decks). */
export const CardBackPattern = CardBack;

export const FamilyCard = forwardRef<HTMLDivElement, FamilyCardProps>(function FamilyCard(
  { person, stats, kin, meaning, hideKin, no, total, known, home, flipped, back, tilt, className, style, onClick, label },
  ref,
) {
  const tiltHandlers = useTilt(tilt ? 1 : 0.6);
  const facts = factsOf(person);
  const gone = person.deceased || Boolean(person.deathDate);
  const born = yearOf(person.birthDate);
  const family = shown(person.lastName);
  const width = total ? String(total).length : 2;
  const legend = stats.rarity === 'legend';
  const kinWord = hideKin ? '? ? ?' : kin || (home ? 'You' : 'Relative');
  const hasFacts = Boolean(facts.occupation || facts.education || facts.blood);
  const top = (
    <div className="fc-top">
      <span className="fc-name" style={{ '--len': Math.max(10, shortName(person).length) } as CSSProperties}>
        {shortName(person)}
      </span>
      <Age person={person} stats={stats} />
    </div>
  );
  const classes = [
    'fc',
    `is-${stats.rarity}`,
    `g-${person.gender}`,
    gone ? 'is-gone' : '',
    known ? 'is-known' : '',
    hasFacts ? 'has-facts' : '',
    home ? 'is-home' : '',
    flipped ? 'is-flipped' : '',
    onClick ? 'is-button' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={classes}
      style={style}
      data-id={person.id}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={label ?? `${shortName(person)}${kin && !hideKin ? `, ${kin}` : ''}`}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      {...tiltHandlers}
    >
      <div className="fc-inner">
        <div className="fc-face fc-front">
          {!legend && top}
          <div className="fc-art">
            <LifeRings
              id={person.id}
              age={stats.age}
              kids={stats.kids}
              rarity={stats.rarity}
              h={legend ? 168 : 116}
              monogram={initials(person)}
              photo={person.photo || undefined}
            />
            {stats.rarity === 'rare' && <span className="fc-holo" aria-hidden="true" />}
            {gone && <Garland />}
            {legend && top}
            {stats.rarity !== 'common' && (
              <span className="fc-rarity">
                <Sparkle size={10} />
                {RARITY_LABEL[stats.rarity]}
              </span>
            )}
            {home && (
              <span className="fc-ribbon" aria-hidden="true">
                You
              </span>
            )}
            {known && <span className="fc-stamp">Known</span>}
          </div>
          <div className={`fc-kin${hideKin ? ' is-hidden' : ''}`}>
            <span className="fc-kin-word" style={{ '--len': Math.max(12, kinWord.length) } as CSSProperties}>
              {kinWord}
            </span>
            {!hideKin && meaning && <span className="fc-kin-meaning">{meaning}</span>}
          </div>
          <dl className="fc-stats">
            <div>
              <dd>{born ?? '-'}</dd>
              <dt>Born</dt>
            </div>
            <div>
              <dd>{stats.children}</dd>
              <dt>{stats.children === 1 ? 'Child' : 'Children'}</dt>
            </div>
            <div>
              <dd>{stats.descendants}</dd>
              <dt>Family</dt>
            </div>
          </dl>
          {hasFacts && (
            <div className="fc-facts">
              {facts.occupation && (
                <span>
                  <Briefcase size={11} />
                  {facts.occupation}
                </span>
              )}
              {facts.education && (
                <span>
                  <GraduationCap size={11} />
                  {facts.education}
                </span>
              )}
              {facts.blood && (
                <span>
                  <Droplet size={11} />
                  {facts.blood}
                </span>
              )}
            </div>
          )}
          <div className="fc-foot">
            <span className="fc-family">{family || ' '}</span>
            {no !== undefined && (
              <span className="fc-no">
                <span className="fc-glyph" aria-hidden="true">
                  {GLYPH[stats.rarity]}
                </span>
                {pad(no, width)}
                {total ? <small>/{total}</small> : null}
              </span>
            )}
          </div>
          {legend && <Filigree />}
          {legend && <span className="fc-sweep" aria-hidden="true" />}
          <span className="fc-foil" aria-hidden="true" />
          <span className="fc-glare" aria-hidden="true" />
        </div>
        <div className="fc-face fc-back">{back ?? <CardBackPattern />}</div>
      </div>
    </div>
  );
});
