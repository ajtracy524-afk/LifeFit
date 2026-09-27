import { useSyncExternalStore } from 'react';
import { haptic, type CelebrationLevel } from './motion';

/**
 * Celebrations – the ONE feedback line after a meaningful action, shown as an
 * animated chip above the screen. The kind picks the animation (a protein
 * "power" burst is not a water ripple); the level picks its strength:
 *
 *   1 info / small step · 2 good progress · 3 goal reached · 4 day complete
 *
 * Only one at a time. A weaker one never interrupts a stronger one that is
 * still showing; a stronger one always wins. Everything shown must come from
 * real data (the callers compute it from entries, targets, water values).
 */

export type CelebrationKind = 'power' | 'target' | 'water' | 'grow' | 'sparkle' | 'info' | 'dish' | 'day' | 'check';

export interface Celebration {
  id: number;
  kind: CelebrationKind;
  icon: string;
  title: string;
  detail?: string;
  level: CelebrationLevel;
}

/** How long a chip stays (ms) – stronger moments a little longer. */
export const CELEBRATION_MS: Record<CelebrationLevel, number> = { 1: 1800, 2: 2200, 3: 2800, 4: 3600 };

let current: Celebration | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function celebrate(input: Omit<Celebration, 'id'>, opts: { haptics?: boolean } = {}): boolean {
  if (current && current.level > input.level) return false;
  current = { ...input, id: nextId++ };
  if (opts.haptics !== false) haptic(input.level);
  clearTimeout(timer);
  const id = current.id;
  timer = setTimeout(() => dismissCelebration(id), CELEBRATION_MS[input.level]);
  emit();
  return true;
}

export function dismissCelebration(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

export function currentCelebration(): Celebration | null {
  return current;
}

export function useCelebration(): Celebration | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
