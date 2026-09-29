import { describe, expect, it } from 'vitest';
import { CALORIE_ZONE, calorieStatus, calorieTolerance, isDayFinished } from './calorieStatus';
import { NUTRITION_RULES } from './engine/nutritionRules';

/**
 * Small motivating signals on Heute / Ernährung – computed from real data
 * only: the day target and log entries for calories, stored day values for
 * water. No points, no invented streaks.
 */

const status = (eaten: number, targetKcal = 2000, planned = 0, finished = false) => calorieStatus({ eaten, planned, targetKcal, finished })!;

describe('calorie target zone', () => {
  it('is defined once: 10 % of the day target (the coach share), between 150 and 300 kcal', () => {
    expect(CALORIE_ZONE.share).toBe(NUTRITION_RULES.overShare);
    expect(calorieTolerance(1200)).toBe(150); // small target → at least 150
    expect(calorieTolerance(2000)).toBe(200);
    expect(calorieTolerance(2500)).toBe(250);
    expect(calorieTolerance(3600)).toBe(300); // big target → at most 300
  });

  it('inside the zone is "Im Ziel" – also slightly below or above', () => {
    for (const eaten of [1800, 2000, 2200]) expect(status(eaten).key).toBe('in_zone');
    expect(status(2000).label).toMatch(/Im Ziel/);
    expect(status(2000).tone).toBe('good');
  });

  it('slightly over, clearly over (from twice the tolerance) – friendly words, no compensation', () => {
    expect(status(2300).key).toBe('over');
    expect(status(2300).label).toBe('Etwas darüber');
    expect(status(2401).key).toBe('well_over');
    expect(status(2401).label).toBe('Heute deutlich darüber');
    expect(status(2401).detail).not.toMatch(/weniger|verbrennen|ausgleichen|kompensier/i);
  });

  it('below the zone during the day is room left, or "Auf Kurs" when the plan fills it', () => {
    expect(status(600).key).toBe('room');
    expect(status(600).detail).toBe('1.400 kcal offen');
    expect(status(600, 2000, 1350).key).toBe('on_track');
    // A plan that would overshoot is not "auf Kurs".
    expect(status(600, 2000, 2000).key).toBe('room');
  });

  it('a finished day below the zone is "Etwas darunter" – not before', () => {
    expect(status(1500, 2000, 0, true).key).toBe('under');
    expect(status(1500, 2000, 0, false).key).toBe('room');
    expect(isDayFinished('2026-09-21', '2026-09-22', 9)).toBe(true);
    expect(isDayFinished('2026-09-22', '2026-09-22', CALORIE_ZONE.lateHour - 1)).toBe(false);
    expect(isDayFinished('2026-09-22', '2026-09-22', CALORIE_ZONE.lateHour)).toBe(true);
  });

  it('works with different day targets – the same 250 kcal are in the zone for 2500, over for 1500', () => {
    expect(status(2750, 2500).key).toBe('in_zone');
    expect(status(1750, 1500).key).toBe('over');
  });

  it('no target → no status', () => {
    expect(calorieStatus({ eaten: 500, planned: 0, targetKcal: 0, finished: false })).toBeUndefined();
  });
});

