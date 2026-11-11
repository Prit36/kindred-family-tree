import { useState } from 'react';
import { buildDate, daysInMonth, MONTHS, parseDate } from '../lib/dates';

interface Props {
  value: string;
  onChange: (value: string) => void;
  label: string;
}

/** A date where the day and month are optional - often only the year is known. */
export function DateInput({ value, onChange, label }: Props) {
  const [parts, setParts] = useState(() => {
    const p = parseDate(value);
    return { d: p.d ? String(p.d) : '', m: p.m ? String(p.m) : '', y: p.y ? String(p.y) : '' };
  });

  const update = (patch: Partial<typeof parts>) => {
    const next = { ...parts, ...patch };
    // Never show a day that can't exist: it would be dropped silently when saving.
    const max = daysInMonth(Number(next.m) || null, next.y.length === 4 ? Number(next.y) : null);
    if (Number(next.d) > max) {
      if (patch.d !== undefined) return; // ignore the keystroke that made it impossible
      next.d = String(max); // month or year changed underneath it: 31 → 30, 29 Feb → 28
    }
    setParts(next);
    onChange(buildDate({ y: Number(next.y) || null, m: Number(next.m) || null, d: Number(next.d) || null }));
  };

  const digits = (s: string, max: number) => s.replace(/\D/g, '').slice(0, max);

  // Anything typed that wouldn't be saved gets said out loud rather than quietly discarded.
  const hasDay = Number(parts.d) > 0;
  const hasMonth = Boolean(parts.m);
  const yearProblem =
    !parts.y && (hasDay || hasMonth)
      ? 'Add a year to save this date'
      : parts.y && parts.y.length < 4
        ? 'Use a four-digit year'
        : '';
  const monthProblem = !yearProblem && hasDay && !hasMonth ? 'Pick a month to keep the day' : '';
  const problem = yearProblem || monthProblem;

  return (
    <>
      <div className="date-input" role="group" aria-label={label}>
        <input
          className="input date-day"
          inputMode="numeric"
          placeholder="Day"
          aria-label={`${label} day`}
          value={parts.d}
          onChange={(e) => update({ d: digits(e.target.value, 2) })}
        />
        <select
          className={`input date-month${monthProblem ? ' is-wanting' : ''}`}
          aria-label={`${label} month`}
          value={parts.m}
          onChange={(e) => update({ m: e.target.value })}
        >
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <input
          className={`input date-year${yearProblem ? ' is-wanting' : ''}`}
          inputMode="numeric"
          placeholder="Year"
          aria-label={`${label} year`}
          value={parts.y}
          onChange={(e) => update({ y: digits(e.target.value, 4) })}
        />
      </div>
      {problem && (
        <span className="field-note" role="status">
          {problem}
        </span>
      )}
    </>
  );
}
