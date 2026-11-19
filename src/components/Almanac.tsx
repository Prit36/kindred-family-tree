import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { CalendarDays, Flower2 } from 'lucide-react';
import { useStore } from '../store';
import {
  addDays,
  birthdayBook,
  daysBetween,
  familyNumbers,
  monthDays,
  onDay,
  today as startOfToday,
  type DayEntry,
  type Tally,
} from '../lib/almanac';
import { MONTHS } from '../lib/dates';
import { num } from '../lib/format';
import { relationLabels } from '../lib/naming';
import { displayName, fullName, shortName, shown } from '../lib/tree';
import { Avatar } from './Avatar';
import { CountUp } from './CountUp';
import { confettiFrom } from '../lib/confetti';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** How far ahead "coming up" looks. */
export const AHEAD = 30;

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

const onActivate = (run: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    run();
  }
};

// ---------------------------------------------------------------------------
// Coming up: the year as a wheel, the days ahead as a strip, the day as faces
// ---------------------------------------------------------------------------

interface Cell {
  date: Date;
  entries: DayEntry[];
}

/** Twelve petals, January at the top: the longer the petal, the more birthdays that month. */
function Wheel({
  months,
  picked,
  now,
  centre,
  onPick,
}: {
  months: number[];
  picked: number | null;
  now: Date;
  centre: { value: string; label: string };
  onPick: (month: number | null) => void;
}) {
  const max = Math.max(1, ...months);
  // Months rarely differ by much; measuring from a little under the quietest lets the difference show.
  const floor = Math.min(...months) * 0.6;
  const daysThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const todayAngle = now.getMonth() * 30 - 15 + ((now.getDate() - 0.5) / daysThisMonth) * 30;

  return (
    <svg className="wheel" viewBox="-8 -8 216 216" role="group" aria-label="Birthdays through the year">
      <circle className="wheel-ring" cx="100" cy="100" r="82" />
      {months.map((count, i) => {
        const length = 10 + (Math.max(0, count - floor) / Math.max(1, max - floor)) * 38;
        const pick = () => onPick(picked === i ? null : i);
        return (
          <g key={i} transform={`rotate(${i * 30} 100 100)`}>
            <g
              className={`wheel-petal${picked === i ? ' is-picked' : ''}${now.getMonth() === i ? ' is-now' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={picked === i}
              aria-label={`${MONTH_NAMES[i]}: ${plural(count, 'birthday')}`}
              onClick={pick}
              onKeyDown={onActivate(pick)}
            >
              <path className="wheel-hit" d="M100 100 L77 12 A91 91 0 0 1 123 12 Z" />
              <rect
                className="wheel-bar"
                x="92"
                y={66 - length}
                width="16"
                height={length}
                rx="8"
                style={{ animationDelay: `${i * 35}ms` }}
              />
              <text className="wheel-month" x="100" y="6" transform={`rotate(${-i * 30} 100 6)`}>
                {MONTHS[i]}
              </text>
            </g>
          </g>
        );
      })}
      <circle className="wheel-today" cx="100" cy="18" r="3.5" transform={`rotate(${todayAngle} 100 100)`} />
      <text className="wheel-value" x="100" y="100">
        {centre.value}
      </text>
      <text className="wheel-label" x="100" y="116">
        {centre.label}
      </text>
    </svg>
  );
}

/** A bar for each day: tall days are busy, a gold bead marks a milestone birthday. */
function DayStrip({ cells, picked, now, onPick }: { cells: Cell[]; picked: number; now: Date; onPick: (i: number) => void }) {
  const max = Math.max(1, ...cells.map((c) => c.entries.length));
  return (
    <div className="strip" role="group" aria-label="Days">
      {cells.map(({ date, entries }, i) => {
        const d = date.getDate();
        const isToday = daysBetween(now, date) === 0;
        const labelled = i === picked || ((d % 5 === 0 || d === 1) && Math.abs(i - picked) > 1);
        return (
          <button
            key={date.getTime()}
            type="button"
            className={`strip-day${i === picked ? ' is-picked' : ''}${isToday ? ' is-today' : ''}${entries.length === 0 ? ' is-empty' : ''}${d === 1 && i > 0 ? ' is-first' : ''}`}
            aria-pressed={i === picked}
            aria-label={`${d} ${MONTH_NAMES[date.getMonth()]}: ${plural(entries.length, 'person', 'people')}`}
            onClick={() => onPick(i)}
          >
            <span className="strip-bead" data-on={entries.some((e) => e.milestone) || undefined} />
            <span
              className="strip-bar"
              style={{ height: entries.length ? 6 + (entries.length / max) * 44 : 2, animationDelay: `${i * 12}ms` }}
            />
            <span className="strip-num">{labelled ? d : ''}</span>
          </button>
        );
      })}
    </div>
  );
}

function Face({ entry, kin, onShow }: { entry: DayEntry; kin: string | undefined; onShow: (ids: string[]) => void }) {
  const tree = useStore((s) => s.tree);
  const { person, kind, years, milestone } = entry;
  const memory = kind === 'remembrance';
  return (
    <button
      type="button"
      className={`face${milestone ? ' is-milestone' : ''}${memory ? ' is-memory' : ''}`}
      title={fullName(tree, person)}
      onClick={() => onShow([person.id])}
    >
      <span className="face-photo">
        <Avatar person={person} size={44} />
        <span className="face-age" aria-label={memory ? 'In memory' : years !== null ? `Turns ${years}` : 'Birthday'}>
          {memory ? <Flower2 size={11} /> : (years ?? '·')}
        </span>
      </span>
      <span className="face-name">{shortName(person)}</span>
      <span className="face-sub">{shown(person.lastName)}</span>
      {memory
        ? years !== null && years > 0 && <span className="face-kin">{plural(years, 'year')} ago</span>
        : kin && <span className="face-kin">{kin}</span>}
    </button>
  );
}

function dayName(date: Date, now: Date): string {
  const away = daysBetween(now, date);
  return away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : WEEKDAYS[date.getDay()];
}

function daySummary(entries: DayEntry[]): string {
  const birthdays = entries.filter((e) => e.kind === 'birthday');
  const memories = entries.length - birthdays.length;
  const parts: string[] = [];
  if (birthdays.length) parts.push(plural(birthdays.length, 'birthday'));
  if (memories) parts.push(`${num(memories)} remembered`);
  const milestones = birthdays.filter((e) => e.milestone);
  if (milestones.length === 1) parts.push(`${shortName(milestones[0].person)} turns ${milestones[0].years}`);
  else if (milestones.length > 1) parts.push(`${milestones.length} milestones`);
  return parts.join(' · ');
}

export function ComingUp({ onShow }: { onShow: (ids: string[]) => void }) {
  const tree = useStore((s) => s.tree);
  const naming = useStore((s) => s.naming);
  const kin = relationLabels(tree, naming);
  const book = useMemo(() => birthdayBook(tree), [tree]);
  const now = useMemo(startOfToday, []);

  // null = the days ahead of today; otherwise a month picked on the wheel.
  const [month, setMonth] = useState<number | null>(null);
  const [pickedDay, setPickedDay] = useState<number | null>(null);

  const cells = useMemo<Cell[]>(() => {
    const dates = month === null ? Array.from({ length: AHEAD + 1 }, (_, i) => addDays(now, i)) : monthDays(month, now);
    return dates.map((date) => ({ date, entries: onDay(book, date) }));
  }, [book, month, now]);

  const fallback = useMemo(() => {
    const todayAt = cells.findIndex((c) => daysBetween(now, c.date) === 0);
    if (todayAt >= 0 && cells[todayAt].entries.length) return todayAt;
    const first = cells.findIndex((c) => c.entries.length > 0);
    return first >= 0 ? first : Math.max(0, todayAt);
  }, [cells, now]);
  const picked = pickedDay !== null && pickedDay < cells.length ? pickedDay : fallback;
  const cell = cells[picked];
  const isToday = daysBetween(now, cell.date) === 0;
  const birthdaysToday = cell.entries.some((e) => e.kind === 'birthday');

  // Someone's birthday today: a burst of paper over their faces, the first time the
  // almanac is opened that day.
  const facesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isToday || !birthdaysToday) return;
    const key = `kindred.party.${now.toDateString()}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* celebrate anyway */
    }
    const t = window.setTimeout(() => confettiFrom(facesRef.current, { count: 110 }), 450);
    return () => window.clearTimeout(t);
  }, [isToday, birthdaysToday, now]);

  const total = cells.reduce((sum, c) => sum + c.entries.length, 0);
  const centre =
    month === null
      ? { value: num(total), label: `next ${AHEAD} days` }
      : { value: num(book.months[month]), label: MONTH_NAMES[month] };

  const pickMonth = (m: number | null) => {
    setMonth(m);
    setPickedDay(null);
  };

  return (
    <div className="almanac-pane coming" role="tabpanel">
      <div className="coming-year">
        <Wheel months={book.months} picked={month} now={now} centre={centre} onPick={pickMonth} />
        <button type="button" className="btn coming-reset" aria-pressed={month === null} onClick={() => pickMonth(null)}>
          <CalendarDays size={14} /> Next {AHEAD} days
        </button>
      </div>

      <div className="coming-days">
        <DayStrip cells={cells} picked={picked} now={now} onPick={setPickedDay} />
        <div className="day-head">
          <h3>
            <strong>{dayName(cell.date, now)}</strong> {cell.date.getDate()} {MONTH_NAMES[cell.date.getMonth()]}
          </h3>
          <span>{daySummary(cell.entries)}</span>
        </div>
        {cell.entries.length === 0 ? (
          <p className="insights-empty">Nobody's day.</p>
        ) : (
          <div
            className={`faces${isToday && birthdaysToday ? ' is-party' : ''}`}
            key={cell.date.getTime()}
            ref={facesRef}
          >
            {cell.entries.map((e) => (
              <Face key={`${e.kind}-${e.person.id}`} entry={e} kin={kin.get(e.person.id)} onShow={onShow} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The family in numbers
// ---------------------------------------------------------------------------

function Bars({ rows, tone, label = (t) => t }: { rows: Tally[]; tone: string; label?: (text: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="bars" style={{ '--tone': tone } as CSSProperties}>
      {rows.map((r, i) => (
        <li key={r.label}>
          <span className="bars-label">{label(r.label)}</span>
          <span className="bars-track">
            <i style={{ width: `${(r.count / max) * 100}%`, animationDelay: `${i * 40}ms` }} />
          </span>
          <span className="bars-n">{num(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

export function FamilyNumbers({ onShow }: { onShow: (ids: string[]) => void }) {
  const tree = useStore((s) => s.tree);
  const n = useMemo(() => familyNumbers(tree), [tree]);

  const decadeMax = Math.max(1, ...n.decades.flatMap((d) => [d.male, d.female]));
  const nameMax = Math.max(2, ...n.givenNames.map((t) => t.count));
  const nameMin = Math.min(...n.givenNames.map((t) => t.count), nameMax);
  const bloodMax = Math.max(1, ...n.blood.map((b) => b.count));
  const more = (shownCount: number, all: number, what: string) =>
    all > shownCount ? <span className="alm-more">+{num(all - shownCount)} more {what}</span> : null;

  return (
    <div className="almanac-pane numbers" role="tabpanel">
      <p className="numbers-lead">
        <b><CountUp value={n.people} ms={1100} /></b> {n.people === 1 ? 'person' : 'people'}
        {n.families > 1 && (
          <>
            {' '}
            in <b><CountUp value={n.families} ms={1100} /></b> families
          </>
        )}
        {n.firstYear && n.lastYear && n.lastYear > n.firstYear && (
          <>
            , born between <b>{n.firstYear}</b> and <b>{n.lastYear}</b>
          </>
        )}
        .
        <span className="numbers-sub">
          {[`${num(n.living)} living`, n.remembered > 0 && `${num(n.remembered)} remembered`, n.couples > 0 && plural(n.couples, 'couple')]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </p>

      <div className="numbers-grid">
        {n.decades.length > 1 && (
          <section>
            <h3 className="alm-h">
              Born in each decade <span className="alm-key is-m">men</span>
              <span className="alm-key is-f">women</span>
            </h3>
            <div className="pyramid">
              {n.decades.map((d, i) => (
                <div key={d.start} className="pyr-row">
                  <span className="pyr-n">{d.male || ''}</span>
                  <span className="pyr-bar is-m">
                    <i style={{ width: `${(d.male / decadeMax) * 100}%`, animationDelay: `${i * 40}ms` }} />
                  </span>
                  <span className="pyr-label">{d.start}s</span>
                  <span className="pyr-bar is-f">
                    <i style={{ width: `${(d.female / decadeMax) * 100}%`, animationDelay: `${i * 40}ms` }} />
                  </span>
                  <span className="pyr-n">{d.female || ''}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {(n.records.length > 0 || n.busiestDay) && (
          <section>
            <h3 className="alm-h">Record holders</h3>
            <div className="records">
              {n.records.map((r) => (
                <button key={r.title} type="button" className="record" onClick={() => onShow([r.person.id])}>
                  <Avatar person={r.person} size={38} />
                  <span className="record-text">
                    <span className="record-title">{r.title}</span>
                    <span className="record-name">{displayName(r.person)}</span>
                    <span className="record-detail">{r.detail}</span>
                  </span>
                </button>
              ))}
              {n.busiestDay && (
                <div className="record">
                  <span className="record-glyph">
                    <b>{n.busiestDay.day}</b>
                    {MONTHS[n.busiestDay.month - 1]}
                  </span>
                  <span className="record-text">
                    <span className="record-title">Most shared birthday</span>
                    <span className="record-name">
                      {n.busiestDay.day} {MONTH_NAMES[n.busiestDay.month - 1]}
                    </span>
                    <span className="record-detail">{plural(n.busiestDay.count, 'person', 'people')}</span>
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

        {n.givenNames.length > 2 && (
          <section>
            <h3 className="alm-h">Names you hear most</h3>
            <p className="cloud">
              {n.givenNames.map((t) => (
                <span
                  key={t.label}
                  className={`cloud-name g-${t.gender}`}
                  style={{ fontSize: 13 + ((t.count - nameMin) / Math.max(1, nameMax - nameMin)) * 11 }}
                >
                  {shown(t.label)}
                  <sup>{t.count}</sup>
                </span>
              ))}
            </p>
          </section>
        )}

        {n.surnames.length > 1 && (
          <section>
            <h3 className="alm-h">Surnames {more(n.surnames.length, n.surnameCount, '')}</h3>
            <Bars rows={n.surnames} tone="var(--accent)" label={shown} />
          </section>
        )}

        {n.occupations.length > 1 && (
          <section>
            <h3 className="alm-h">What people do {more(n.occupations.length, n.occupationCount, '')}</h3>
            <Bars rows={n.occupations} tone="var(--warn)" />
          </section>
        )}

        {n.education.length > 1 && (
          <section>
            <h3 className="alm-h">Schooling</h3>
            <Bars rows={n.education} tone="var(--other)" />
          </section>
        )}

        {n.blood.length > 1 && (
          <section className="numbers-wide">
            <h3 className="alm-h">Blood groups</h3>
            <div className="drops">
              {n.blood.map((b) => (
                <span key={b.label} className="drop">
                  <svg viewBox="0 0 24 30" style={{ width: 14 + Math.sqrt(b.count / bloodMax) * 22 }} aria-hidden="true">
                    <path d="M12 1.5C12 1.5 2.5 13 2.5 19.5a9.5 9.5 0 0 0 19 0C21.5 13 12 1.5 12 1.5Z" />
                  </svg>
                  <b>{b.label}</b>
                  <small>{num(b.count)}</small>
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
