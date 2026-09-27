import { useEffect, useRef, useState } from 'react';

/**
 * Motion system – the few rules every animation in LifeFit follows:
 *
 *   User action → immediate reaction (press, check snaps in)
 *              → progress changes visibly (numbers glide, ring/bars sweep)
 *              → context feedback (one celebration line, see celebrate.ts)
 *              → a real goal reached? a stronger moment (level 3/4)
 *
 * Animations are triggered by REAL data changes (a value went up, a goal
 * flipped to reached) – never on a plain screen visit and never invented.
 * CSS does the moving (transform/opacity only, GPU-friendly); JS only decides
 * when. Reduced motion: CSS durations collapse globally (styles/global.css),
 * particles are not rendered, numbers jump – the information stays.
 */

export type CelebrationLevel = 1 | 2 | 3 | 4;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Short vibration where the platform offers it (Android browsers) – silently nothing elsewhere. */
const HAPTICS: Record<CelebrationLevel, number | number[]> = { 1: 8, 2: 14, 3: [14, 60, 22], 4: [16, 60, 16, 60, 30] };
export function haptic(level: CelebrationLevel): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(HAPTICS[level]);
  } catch {
    /* not allowed (no user gesture, iframe …) – feedback is visual anyway */
  }
}

/**
 * A counter that goes up every time `value` INCREASES (not on mount, not on a
 * decrease). Use it as a React key to replay an "impact" animation.
 */
export function useIncrease(value: number): number {
  const prev = useRef(value);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (value > prev.current + 1e-9) setCount((c) => c + 1);
    prev.current = value;
  }, [value]);
  return count;
}

/** A counter that goes up every time `condition` flips from false to true (not on mount). */
export function useCrossing(condition: boolean): number {
  const prev = useRef(condition);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (condition && !prev.current) setCount((c) => c + 1);
    prev.current = condition;
  }, [condition]);
  return count;
}

/** True for `ms` after `value` changed (not on mount) – for one-shot state transitions (eaten, replaced). */
export function useJustChanged<T>(value: T, ms = 900): boolean {
  const prev = useRef(value);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    setActive(true);
    const t = window.setTimeout(() => setActive(false), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return active;
}

let screenMountedAt = -Infinity;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Call at the top of a screen component: marks "the screen just appeared".
 * Runs during render (before the children), so children rendered in the same
 * pass know they are part of the first paint.
 */
export function useScreenMount(): void {
  useState(() => {
    screenMountedAt = now();
    return 0;
  });
}

/**
 * True if this element appeared AFTER its screen was already shown – a meal
 * that was just replaced, an entry just logged. Such elements animate in;
 * everything present on arrival simply is there.
 */
export function useLateMount(): boolean {
  const [late] = useState(() => now() - screenMountedAt > 400);
  return late;
}
