// @vitest-environment jsdom
import { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CelebrationHost } from '../components/ui/Celebration';
import { useCountUp } from '../components/ui/CountUp';
import { celebrate, currentCelebration, dismissCelebration, CELEBRATION_MS } from './celebrate';
import { haptic, prefersReducedMotion, useCrossing, useIncrease, useJustChanged } from './motion';

/**
 * The motion system reacts to REAL changes only: an increase, a goal flipping
 * to reached. Nothing animates on mount; one celebration at a time, the
 * stronger one wins; reduced motion keeps the information, drops the motion.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  dismissCelebration();
  vi.restoreAllMocks();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const mockReducedMotion = (reduce: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};

let set: (n: number) => void = () => {};
function Probe() {
  const [value, setValue] = useState(10);
  set = setValue;
  const inc = useIncrease(value);
  const cross = useCrossing(value >= 50);
  const changed = useJustChanged(value, 10_000);
  const shown = useCountUp(value);
  return <p data-inc={inc} data-cross={cross} data-changed={changed} data-shown={shown} />;
}
const probe = () => container.querySelector('p')!.dataset;

describe('motion hooks – triggered by real changes, never on mount', () => {
  it('useIncrease counts increases only; useCrossing counts false → true only; useJustChanged flags a change', async () => {
    root = createRoot(container);
    await act(async () => root!.render(<StrictMode><Probe /></StrictMode>));
    expect(probe()).toMatchObject({ inc: '0', cross: '0', changed: 'false' });
    await act(async () => set(30));
    expect(probe()).toMatchObject({ inc: '1', cross: '0', changed: 'true' });
    await act(async () => set(20)); // a decrease: no impact
    expect(probe().inc).toBe('1');
    await act(async () => set(60)); // crosses 50
    expect(probe()).toMatchObject({ inc: '2', cross: '1' });
    await act(async () => set(70)); // still reached – no second crossing
    expect(probe()).toMatchObject({ inc: '3', cross: '1' });
    await act(async () => set(40));
    await act(async () => set(55)); // reached again
    expect(probe().cross).toBe('2');
  });

  it('numbers jump straight to the value when motion is reduced (or unavailable) – the information is never delayed', async () => {
    mockReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    root = createRoot(container);
    await act(async () => root!.render(<Probe />));
    await act(async () => set(1234));
    expect(probe().shown).toBe('1234');
  });
});

describe('celebrations – one at a time, the stronger one wins', () => {
  it('a weaker celebration never interrupts a stronger one; a stronger one replaces a weaker one', () => {
    expect(celebrate({ kind: 'power', icon: '💪', title: '+30 g Protein', level: 2 })).toBe(true);
    expect(celebrate({ kind: 'info', icon: 'ℹ️', title: 'Info', level: 1 })).toBe(false);
    expect(currentCelebration()?.title).toBe('+30 g Protein');
    expect(celebrate({ kind: 'day', icon: '✨', title: 'Tag abgeschlossen', level: 4 })).toBe(true);
    expect(currentCelebration()?.level).toBe(4);
  });

  it('disappears by itself after its time (stronger moments stay a little longer)', () => {
    vi.useFakeTimers();
    celebrate({ kind: 'water', icon: '💧', title: 'Wasserziel erreicht', level: 3 });
    vi.advanceTimersByTime(CELEBRATION_MS[3] - 10);
    expect(currentCelebration()).not.toBeNull();
    vi.advanceTimersByTime(20);
    expect(currentCelebration()).toBeNull();
    expect(CELEBRATION_MS[1]).toBeLessThan(CELEBRATION_MS[4]);
    vi.useRealTimers();
  });

  it('haptics only where the platform offers vibration – silently nothing otherwise', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic(3);
    expect(vibrate).toHaveBeenCalledWith([14, 60, 22]);
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
    expect(() => haptic(1)).not.toThrow();
  });
});

describe('celebration chip', () => {
  const render = async () => {
    root = createRoot(container);
    await act(async () => root!.render(<CelebrationHost />));
  };
  const chip = () => container.querySelector<HTMLElement>('[data-testid="celebration"]');

  it('shows kind, level and text; a reached goal brings particles', async () => {
    mockReducedMotion(false);
    await render();
    await act(async () => void celebrate({ kind: 'water', icon: '💧', title: 'Wasserziel erreicht', detail: '2 L heute', level: 3 }));
    expect(chip()!.dataset).toMatchObject({ kind: 'water', level: '3' });
    expect(chip()!.textContent).toBe('💧Wasserziel erreicht2 L heute');
    expect(chip()!.querySelectorAll('[class*="particles"] > span')).toHaveLength(10);
    expect(chip()!.querySelectorAll('[class*="ripple"]')).toHaveLength(2);
  });

  it('small steps have no particles; reduced motion keeps the message but drops all particles', async () => {
    mockReducedMotion(false);
    await render();
    await act(async () => void celebrate({ kind: 'grow', icon: '🌱', title: '+8 g Ballaststoffe', level: 2 }));
    expect(chip()!.querySelector('[class*="particles"]')).toBeNull();
    await act(async () => dismissCelebration());
    mockReducedMotion(true);
    await act(async () => void celebrate({ kind: 'day', icon: '✨', title: 'Tag abgeschlossen', level: 4 }));
    expect(chip()!.textContent).toContain('Tag abgeschlossen');
    expect(chip()!.querySelector('[class*="particles"]')).toBeNull();
  });

  it('a tap on the chip dismisses it', async () => {
    await render();
    await act(async () => void celebrate({ kind: 'check', icon: '✓', title: 'Eingeplant', level: 1 }));
    await act(async () => chip()!.click());
    expect(chip()).toBeNull();
  });
});
