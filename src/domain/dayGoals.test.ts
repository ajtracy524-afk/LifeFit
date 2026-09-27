import { describe, expect, it } from 'vitest';
import { emptyState } from '../store/persistence';
import { dayGoals, loggingStreak } from './dayGoals';
import { foodFeedback } from './foodFeedback';
import type { AppState, LogEntry, PlannedMeal } from './types';

/** Day goals and consistency – only from real data, a goal without data is not shown, no "lost" states. */

const MON = '2026-09-21';
const base = (patch: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  targets: [{ id: 't', validFrom: '2026-01-01', method: 'formula', kcal: 2000, protein: 120, carbs: 220, fat: 70 }],
  closedDayTargets: { [MON]: 2000 },
  ...patch,
});
const meal = (id: string, status: PlannedMeal['status']): PlannedMeal => ({ id, date: MON, slot: 'lunch', recipeId: 'chili', servings: 1, status, source: 'suggest' });
const entry = (kcal: number, protein: number, patch: Partial<LogEntry> = {}): LogEntry => ({ id: `e${kcal}${protein}`, date: MON, slot: 'lunch', loggedAt: `${MON}T12:00:00Z`, name: 'x', method: 'quick', macros: { kcal, protein, carbs: 0, fat: 0 }, ...patch });

describe('day goals', () => {
  it('meals, calories, protein – and water only with a water goal', () => {
    const g = dayGoals(base({ plannedMeals: [meal('a', 'eaten'), meal('b', 'planned')], logEntries: [entry(900, 50)] }), MON);
    expect(g.goals.map((x) => [x.key, x.done, x.detail])).toEqual([
      ['meals', false, '1 / 2'],
      ['calories', false, "900 / 2'000 kcal"],
      ['protein', false, '50 / 120 g'],
    ]);
    expect(g.complete).toBe(false);
  });

  it('a replaced meal counts as handled; a skipped one without replacement does not count at all', () => {
    const s = base({ plannedMeals: [meal('a', 'skipped'), meal('b', 'skipped')], logEntries: [entry(500, 20, { replacedMealId: 'a' })] });
    expect(dayGoals(s, MON).goals.find((g) => g.key === 'meals')).toMatchObject({ done: true, detail: '1 / 1' });
  });

  it('the day is complete only when every shown goal is reached', () => {
    const goal = { ...emptyState().nutritionProfile, diet: 'omnivore', excluded: [], slots: ['lunch'], waterGoalMl: 2000 } as AppState['nutritionProfile'];
    const almost = base({ nutritionProfile: goal, plannedMeals: [meal('a', 'eaten')], logEntries: [entry(1950, 130)], water: { [MON]: 1750 } });
    expect(dayGoals(almost, MON)).toMatchObject({ done: 3, complete: false });
    expect(dayGoals({ ...almost, water: { [MON]: 2000 } }, MON)).toMatchObject({ done: 4, complete: true });
    // Far over the calorie zone is not "complete", however much protein.
    expect(dayGoals({ ...almost, water: { [MON]: 2000 }, logEntries: [entry(2600, 150)] }, MON).complete).toBe(false);
  });

  it('without a target and without a plan there is nothing to complete (never a fake "done")', () => {
    const g = dayGoals({ ...emptyState() }, MON);
    expect(g.goals).toEqual([]);
    expect(g.complete).toBe(false);
  });
});

describe('consistency ("dabei")', () => {
  const on = (...dates: string[]) => dates.map((date) => ({ date }));
  it('counts days in a row with something logged, back from yesterday, today once logged', () => {
    expect(loggingStreak(on('2026-09-20', '2026-09-19', '2026-09-18'), MON)).toBe(3);
    expect(loggingStreak(on(MON, '2026-09-20'), MON)).toBe(2);
  });
  it('a day without entries simply ends the count – nothing "lost", no negative number', () => {
    expect(loggingStreak(on('2026-09-19'), MON)).toBe(0);
    expect(loggingStreak([], MON)).toBe(0);
  });
});

describe('micronutrient feedback', () => {
  const before = { kcal: 500, protein: 10, carbs: 60, fat: 10 };
  it('a vitamin crossing its labelling reference (NRV) with this entry is named – from real values only', () => {
    const f = foodFeedback({ entry: { macros: { kcal: 60, protein: 1, carbs: 14, fat: 0 }, micros: { vitaminC: 60 } }, before, microsBefore: { vitaminC: 30 } });
    expect(f).toEqual({ kind: 'micro', icon: '✨', text: 'Vitamin C: Referenzwert erreicht', nutrient: 'vitaminC' });
  });
  it('no crossing (already above, or the entry has no value) → no micro feedback', () => {
    expect(foodFeedback({ entry: { macros: { kcal: 60, protein: 1, carbs: 14, fat: 0 }, micros: { vitaminC: 60 } }, before, microsBefore: { vitaminC: 90 } })).toBeUndefined();
    expect(foodFeedback({ entry: { macros: { kcal: 60, protein: 1, carbs: 14, fat: 0 } }, before, microsBefore: { vitaminC: 79 } })).toBeUndefined();
  });
});
