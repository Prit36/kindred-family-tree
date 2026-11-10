import { useState } from 'react';
import { buildDate, MONTHS, parseDate } from '../lib/dates';

interface Props {
  value: string;
  onChange: (value: string) => void;
  label: string;
}

/** A date where the day and month are optional — often only the year is known. */
export function DateInput({ value, onChange, label }: Props) {
  const [parts, setParts] = useState(() => {
    const p = parseDate(value);
    return { d: p.d ? String(p.d) : '', m: p.m ? String(p.m) : '', y: p.y ? String(p.y) : '' };
  });

  const update = (patch: Partial<typeof parts>) => {
    const next = { ...parts, ...patch };
    setParts(next);
    onChange(buildDate({ y: Number(next.y) || null, m: Number(next.m) || null, d: Number(next.d) || null }));
  };

  const digits = (s: string, max: number) => s.replace(/\D/g, '').slice(0, max);

  return (
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
        className="input date-month"
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
        className="input date-year"
        inputMode="numeric"
        placeholder="Year"
        aria-label={`${label} year`}
        value={parts.y}
        onChange={(e) => update({ y: digits(e.target.value, 4) })}
      />
    </div>
  );
}
