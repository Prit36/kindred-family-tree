import { forwardRef, memo, useCallback, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
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
  /**
   * Like onClick, but handed the card's id and element. A list passes one function for
   * every card, so cards whose own details haven't changed skip re-rendering.
   */
  onOpen?: (id: string, el: HTMLElement) => void;
  label?: string;
}

const GLYPH = { legend: '★', rare: '◆', common: '●' } as const;

const pad = (n: number, width: number) => String(n).padStart(width, '0');

interface TiltParts {
  inner: HTMLElement | null;
  glare: HTMLElement | null;
  foil: HTMLElement | null;
}

const parts = new WeakMap<HTMLElement, TiltParts>();
/** Cards just turned over don't lean until the turn has played. */
const holdUntil = new WeakMap<HTMLElement, number>();
const settle = new WeakMap<HTMLElement, number>();

function partsOf(el: HTMLElement): TiltParts {
  let p = parts.get(el);
  if (!p || !p.inner?.isConnected) {
    p = {
      inner: el.querySelector<HTMLElement>(':scope > .fc-inner'),
      glare: el.querySelector<HTMLElement>('.fc-front > .fc-glare'),
      foil: el.querySelector<HTMLElement>('.fc-front > .fc-foil'),
    };
    parts.set(el, p);
  }
  return p;
}

/** Puts a card back to rest: no lean, the light fading off it. */
export function untilt(el: HTMLElement, hold = 0) {
  const { inner } = partsOf(el);
  if (inner) inner.style.transform = '';
  if (hold) holdUntil.set(el, performance.now() + hold);
  if (el.dataset.tilting === undefined) return;
  el.dataset.tilting = 'out';
  clearTimeout(settle.get(el));
  settle.set(
    el,
    window.setTimeout(() => {
      if (el.dataset.tilting === 'out') delete el.dataset.tilting;
    }, 400),
  );
}

/**
 * Pointer tilt: the card leans towards the pointer and the light follows it. Only
 * transforms are written, straight onto the parts that move - the card's own style and
 * everything printed on it stay untouched, so leaning costs no restyle and no repaint.
 */
export function useTilt(strength = 1) {
  const frame = useRef(0);
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch') return;
      const el = e.currentTarget;
      if ((holdUntil.get(el) ?? 0) > performance.now()) return;
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const { inner, glare, foil } = partsOf(el);
        const flip = el.classList.contains('is-flipped') ? 180 : 0;
        if (inner) {
          inner.style.transform = `rotateX(${((0.5 - y) * 16 * strength).toFixed(2)}deg) rotateY(${((x - 0.5) * 20 * strength + flip).toFixed(2)}deg)`;
        }
        // The glare is a soft spot twice the card's size, slid so its middle is under the pointer.
        if (glare) glare.style.transform = `translate(${(x * w - w).toFixed(1)}px, ${(y * h - h).toFixed(1)}px)`;
        // The foil's bands run across a sheet bigger than the card, slid as the card turns.
        if (foil) {
          foil.style.transform = `translate(${(-1.6 * w * x).toFixed(1)}px, ${(-1.6 * h * y).toFixed(1)}px)`;
          foil.style.setProperty('--hyp', Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 2).toFixed(2));
        }
        if (el.dataset.tilting !== '') {
          clearTimeout(settle.get(el));
          el.dataset.tilting = '';
        }
      });
    },
    [strength],
  );
  const onPointerLeave = useCallback((e: React.PointerEvent<HTMLElement>) => {
    cancelAnimationFrame(frame.current);
    untilt(e.currentTarget);
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

const Card = forwardRef<HTMLDivElement, FamilyCardProps>(function FamilyCard(
  { person, stats, kin, meaning, hideKin, no, total, known, home, flipped, back, tilt, className, style, onClick, onOpen, label },
  ref,
) {
  const tiltHandlers = useTilt(tilt ? 1 : 0.6);
  const own = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      own.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  // Only a card that can be turned over has a back, and only it is drawn in 3D.
  const twoSided = flipped !== undefined || back !== undefined;
  const firstFlip = useRef(true);
  useLayoutEffect(() => {
    if (firstFlip.current) {
      firstFlip.current = false;
      return;
    }
    if (own.current) untilt(own.current, 750);
  }, [flipped]);
  const press = onClick ?? (onOpen ? () => own.current && onOpen(person.id, own.current) : undefined);
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
    twoSided ? 'has-back' : '',
    press ? 'is-button' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={setRef}
      className={classes}
      style={style}
      data-id={person.id}
      role={press ? 'button' : undefined}
      tabIndex={press ? 0 : undefined}
      aria-label={label ?? `${shortName(person)}${kin && !hideKin ? `, ${kin}` : ''}`}
      onClick={press}
      onKeyDown={
        press
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                press();
              }
            }
          : undefined
      }
      {...tiltHandlers}
    >
      <div className="fc-inner">
        <div className="fc-face fc-front">
          {stats.rarity !== 'common' && <span className="fc-frame" aria-hidden="true" />}
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
        {twoSided && <div className="fc-face fc-back">{back ?? <CardBackPattern />}</div>}
      </div>
    </div>
  );
});

function sameStyle(a?: CSSProperties, b?: CSSProperties) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a) as (keyof CSSProperties)[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/**
 * A card re-renders only when something printed on it changes. Its style is compared by
 * value, since lists build a fresh one for each card on every render.
 */
export const FamilyCard = memo(Card, (a, b) => {
  for (const k in b) {
    const key = k as keyof FamilyCardProps;
    if (key === 'style' ? !sameStyle(a.style, b.style) : a[key] !== b[key]) return false;
  }
  for (const k in a) if (!(k in b)) return false;
  return true;
});
