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

/** `value`, counted up to and written with thousands separators. */
export function CountUp({ value, ms, className }: { value: number; ms?: number; className?: string }) {
  const n = useCountUp(value, ms);
  return <span className={className}>{n.toLocaleString()}</span>;
}
