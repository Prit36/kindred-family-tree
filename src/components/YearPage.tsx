import { ChevronLeft, ChevronRight, Flower2, Pause, Play, X } from 'lucide-react';
import type { YearPage as Page } from '../lib/era';
import { num } from '../lib/format';
import type { Span } from '../lib/timeline';
import { displayName, shortName } from '../lib/tree';
import { Avatar } from './Avatar';

/** How many of a year's newborns get a face; the rest are a count. */
const FACES = 6;
/** How many of those who died that year are named. */
const NAMED = 3;

const years = (n: number) => `${n} ${n === 1 ? 'year' : 'years'}`;

/** Where the selected person was in their own life that year. */
function thatYear(sel: Span, year: number): string | null {
  if (!sel.startKnown) return null;
  const name = shortName(sel.person);
  const born = Math.floor(sel.start);
  if (born > year) return `${name} was born ${years(born - year)} later`;
  if (born === year) return `${name} was born that year`;
  if (!sel.living && Math.floor(sel.end) < year) {
    return sel.endKnown ? `${name} had died ${years(year - Math.floor(sel.end))} before` : null;
  }
  return `${name} was ${year - born}`;
}

interface Props {
  page: Page;
  /** The earliest and latest years the page can be turned to */
  first: number;
  last: number;
  /** The selected person, to say where they were in their own life that year */
  sel: Span | null;
  /** Which side of the timeline it sits on, away from the year's line */
  side: 'left' | 'right';
  top: number;
  /** Where the left side starts: past the column of names */
  inset: number;
  playing: boolean;
  onPlay: () => void;
  onYear: (year: number | null) => void;
  onShow: (id: string) => void;
}

/**
 * One year of the family, as a page: how many were alive and how old they were, who was
 * born, who was the eldest, who was lost. Floats over the timeline beside the year's line.
 */
export function YearPage({ page, first, last, sel, side, top, inset, playing, onPlay, onYear, onShow }: Props) {
  const { year, born, died, eldest } = page;
  const self = sel ? thatYear(sel, year) : null;
  const more = born.length - FACES;

  return (
    <aside
      className={`year-page is-${side}`}
      style={side === 'left' ? { top, left: inset } : { top }}
      aria-label={`The family in ${year}`}
    >
      <header className="yp-head">
        <h3 className="yp-year">{year}</h3>
        <div className="yp-tools">
          <button type="button" className="icon-btn" aria-label="The year before" disabled={year <= first} onClick={() => onYear(year - 1)}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label={playing ? 'Pause' : 'Play the years forward'} disabled={year >= last} onClick={onPlay}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button type="button" className="icon-btn" aria-label="The year after" disabled={year >= last} onClick={() => onYear(year + 1)}>
            <ChevronRight size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label="Back to today" onClick={() => onYear(null)}>
            <X size={16} />
          </button>
        </div>
      </header>

      <p className="yp-sum">
        <b>{num(page.alive)}</b> alive
        {born.length > 0 && <span className="is-born"> · {num(born.length)} born</span>}
        {died.length > 0 && <span> · {num(died.length)} died</span>}
      </p>
      {self && sel && (
        <button type="button" className="yp-self" onClick={() => onShow(sel.person.id)}>
          <Avatar person={sel.person} size={22} />
          {self}
        </button>
      )}

      <h4 className="alm-h">
        Ages that year <span className="alm-key is-m">men</span>
        <span className="alm-key is-f">women</span>
      </h4>
      <div className="pyramid">
        {page.bands.map((b) => (
          <div key={b.from} className="pyr-row">
            <span className="pyr-n">{b.male || ''}</span>
            <span className="pyr-bar is-m">
              <i style={{ width: `${(b.male / page.widest) * 100}%` }} />
            </span>
            <span className="pyr-label">{b.label}</span>
            <span className="pyr-bar is-f">
              <i style={{ width: `${(b.female / page.widest) * 100}%` }} />
            </span>
            <span className="pyr-n">{b.female || ''}</span>
          </div>
        ))}
      </div>

      <h4 className="alm-h">
        Born in {year}
        {born.length === 0 && <span className="alm-more">nobody on record</span>}
      </h4>
      <div className="yp-faces">
        {born.slice(0, FACES).map((p) => (
          <button key={p.id} type="button" className="yp-face" title={displayName(p)} onClick={() => onShow(p.id)}>
            <Avatar person={p} size={34} />
            <span>{shortName(p)}</span>
          </button>
        ))}
        {more > 0 && <span className="yp-more">+{num(more)}</span>}
      </div>

      {eldest && (
        <button type="button" className="yp-eldest" onClick={() => onShow(eldest.person.id)}>
          <Avatar person={eldest.person} size={28} />
          <span>
            <small>Eldest of the family</small>
            <b>{displayName(eldest.person)}</b>, {eldest.age}
          </span>
        </button>
      )}

      {died.length > 0 && (
        <p className="yp-died">
          <Flower2 size={13} aria-hidden="true" />
          <span>
            {died.slice(0, NAMED).map((p, i) => (
              <span key={p.id}>
                {i > 0 && ', '}
                <button type="button" className="link-btn" onClick={() => onShow(p.id)}>
                  {shortName(p)}
                </button>
              </span>
            ))}
            {died.length > NAMED && ` and ${num(died.length - NAMED)} more`} died that year
          </span>
        </p>
      )}
    </aside>
  );
}
