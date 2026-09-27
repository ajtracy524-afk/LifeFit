import { useEffect, useRef, useState } from 'react';

/** Motion only when the device allows it (and where matchMedia exists at all). */
function motionAllowed(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A number that glides to its new value (≈ 0.5 s, ease-out) instead of
 * jumping – "3 → 4" is seen, not missed. The first render shows the value
 * directly (no count-up on every screen visit); with reduced motion it
 * always jumps. Interruptible: a new value continues from where it is.
 */
export function useCountUp(value: number, durationMs = 500): number {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    if (!motionAllowed() || current.current === value) {
      current.current = value;
      setShown(value);
      return;
    }
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const v = from + (value - from) * (1 - (1 - p) ** 3);
      current.current = v;
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);
  return shown;
}

export function CountUp({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  return <>{format(useCountUp(value))}</>;
}
