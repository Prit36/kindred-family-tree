import { useEffect, useRef, useState } from 'react';

const still = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that runs up to `value` (from where it was), easing out, over `ms`. */
export function useCountUp(value: number, ms = 900, from = 0): number {
  const [shown, setShown] = useState(() => (still() ? value : from));
  const current = useRef(shown);
  current.current = shown;
  useEffect(() => {
    if (still()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = current.current;
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

/** One formatter for every count: `toLocaleString` builds a new one on each call. */
const format = new Intl.NumberFormat();

/**
 * `value`, counted up to and written with thousands separators. Each frame of the count
 * is written straight into the text node, so counting re-renders nothing.
 */
export function CountUp({ value, ms = 900, className }: { value: number; ms?: number; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  // Where the count stands, kept across value changes so a new count runs on from it.
  const shown = useRef(still() ? value : 0);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const write = (n: number) => {
      shown.current = n;
      // Into React's own text node, so a later render still finds it.
      if (node.firstChild) node.firstChild.nodeValue = format.format(n);
      else node.textContent = format.format(n);
    };
    if (still()) {
      write(value);
      return;
    }
    const start = performance.now();
    const a = shown.current;
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - start) / ms));
      const n = Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3)));
      if (n !== shown.current) write(n);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return (
    <span ref={el} className={className}>
      {format.format(shown.current)}
    </span>
  );
}
