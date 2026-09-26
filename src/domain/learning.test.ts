import { describe, expect, it } from 'vitest';
import { emptyState } from '../store/persistence';
import { affinityIndex, learnedTrainingDays, learnedTrainingHour, learnFromEvent, LEARNING, preferenceOf, prefKey, type LearningEvent, type Preferences } from './learning';
import { applyWeekChange } from './week';
import type { AppState, PlannedMeal, Workout } from './types';

/**
 * The personalization layer learns slowly and transparently from real
 * behaviour – every score is counted evidence.
 */

const NOW = '2026-09-21T12:00:00Z';
const run = (events: LearningEvent[], prefs: Preferences = {}) => events.reduce((p, e) => learnFromEvent(p, e, NOW), prefs);
const eaten = (recipeId: string, timeBudget: 'low' | 'normal' | 'high' = 'normal'): LearningEvent => ({ type: 'meal_eaten', recipeId, slot: 'dinner', timeBudget });
const skipped = (recipeId: string, timeBudget: 'low' | 'normal' | 'high' = 'normal'): LearningEvent => ({ type: 'meal_skipped', recipeId, slot: 'dinner', timeBudget });
const times = <T,>(n: number, e: T) => Array.from({ length: n }, () => e);
const recipe = (p: Preferences, id: string) => preferenceOf(p[prefKey.recipe(id)]);

describe('learning · meals', () => {
  it('eating raises the preference – slowly', () => {
    const one = recipe(run([eaten('chili')]), 'chili');
    const five = recipe(run(times(5, eaten('chili'))), 'chili');
    const ten = recipe(run(times(10, eaten('chili'))), 'chili');
    expect(one.score).toBeCloseTo(0.2);
    expect(five.score).toBeGreaterThan(0.5);
    expect(ten.score).toBeGreaterThan(five.score);
    expect(ten.confidence).toBeGreaterThan(five.confidence);
    expect(one.confidence).toBeLessThan(0.25);
  });

  it('skipping lowers it: 1× weak, 3× stronger, 5× clear', () => {
    const s = (n: number) => recipe(run(times(n, skipped('chili'))), 'chili').score;
    expect(s(1)).toBeCloseTo(-0.2);
    expect(s(3)).toBeLessThan(-0.4);
    expect(s(5)).toBeLessThan(-0.5);
  });

  it('swapping lowers the original and gives the chosen alternative a weaker plus', () => {
    const p = run([{ type: 'meal_swapped', fromRecipeId: 'chili', toRecipeId: 'bolognese', slot: 'dinner', timeBudget: 'normal' }]);
    expect(recipe(p, 'chili').score).toBeLessThan(0);
    expect(recipe(p, 'bolognese').score).toBeGreaterThan(0);
    expect(recipe(p, 'bolognese').score).toBeLessThan(recipe(run([eaten('bolognese')]), 'bolognese').score);
  });

  it('context: skipping on a busy day counts mostly against "too much effort", not the taste', () => {
    const busy = run(times(3, skipped('chili', 'low')));
    const normal = run(times(3, skipped('chili', 'normal')));
    expect(Math.abs(recipe(busy, 'chili').score)).toBeLessThan(Math.abs(recipe(normal, 'chili').score));
    const aff = affinityIndex(busy);
    expect(aff('chili', 'low')).toBeLessThan(aff('chili', 'normal'));
  });

  it('"doch nicht gegessen" takes the evidence back', () => {
    const p = run([eaten('chili'), { type: 'meal_uneaten', recipeId: 'chili', slot: 'dinner', timeBudget: 'normal' }]);
    expect(recipe(p, 'chili').score).toBe(0);
  });

  it('evidence is capped so behaviour can change again (ratio kept)', () => {
    const p = run(times(60, eaten('chili')));
    const stat = p[prefKey.recipe('chili')]!;
    expect(stat.pos + stat.neg).toBeLessThanOrEqual(LEARNING.maxEvidence + 0.01);
    const after = run(times(10, skipped('chili')), p);
    expect(recipe(after, 'chili').score).toBeLessThan(recipe(p, 'chili').score - 0.3);
  });
});

describe('learning · training', () => {
  it('completed, skipped and moved sessions shape the usual days and hour', () => {
    let p: Preferences = {};
    for (const date of ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24']) {
      p = learnFromEvent(p, { type: 'workout_completed', date, hour: 18 }, NOW);
    }
    p = learnFromEvent(p, { type: 'workout_skipped', date: '2026-09-05' }, NOW);
    expect(learnedTrainingDays(p)).toEqual([1, 3]); // Tuesday, Thursday
    expect(learnedTrainingHour(p)).toBe(18);
    const moved = learnFromEvent(p, { type: 'workout_moved', from: '2026-09-29', to: '2026-10-02' }, NOW);
    expect(preferenceOf(moved[prefKey.weekday(4)]).score).toBeGreaterThan(0);
  });

  it('nothing is claimed without enough evidence', () => {
    const p = learnFromEvent({}, { type: 'workout_completed', date: '2026-09-01', hour: 7 }, NOW);
    expect(learnedTrainingDays(p)).toEqual([]);
    expect(learnedTrainingHour(p)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

function state(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: '2026-09-21T07:00:00Z' },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: '2026-09-21' },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: '2026-09-21', method: 'formula', kcal: 2800, protein: 160, carbs: 330, fat: 80 }],
    training: { programId: 'full-body', weekdays: [0, 2, 4] },
    ...patch,
  };
}
const meal = (id: string, recipeId: string, patch: Partial<PlannedMeal> = {}): PlannedMeal => ({
  id, date: '2026-09-21', slot: 'dinner', recipeId, servings: 1, status: 'planned', source: 'suggest', ...patch,
});

describe('learning · where events come from', () => {
  it('"Gegessen" records once – a second tap adds nothing; undo removes the evidence', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    store.commit(state({ plannedMeals: [meal('m', 'chili')] }));
    const before = store.snapshot();
    actions.markEaten('m');
    actions.markEaten('m');
    expect(store.getState().learning.preferences[prefKey.recipe('chili')]!.pos).toBe(1);
    store.restore(before);
    expect(store.getState().learning.preferences[prefKey.recipe('chili')]).toBeUndefined();
  });

  it('"Anders gegessen" (skip) records a negative signal once', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    store.commit(state({ plannedMeals: [meal('m', 'chili')] }));
    actions.skipMeal('m');
    actions.skipMeal('m');
    expect(store.getState().learning.preferences[prefKey.recipe('chili')]!.neg).toBe(1);
  });

  it('a user swap learns; accepting a suggestion (learn: false) does not', () => {
    const s = state({ plannedMeals: [meal('m', 'chili')] });
    const r = applyWeekChange(s, { type: 'replaceMeal', mealId: 'm', recipeId: 'bolognese' }, new Date(2026, 8, 21, 9));
    expect(r.ok && r.state.learning.preferences[prefKey.recipe('chili')]!.neg).toBe(1);
    const quiet = applyWeekChange(s, { type: 'replaceMeal', mealId: 'm', recipeId: 'bolognese', learn: false }, new Date(2026, 8, 21, 9));
    expect(quiet.ok && quiet.state.learning.preferences).toEqual({});
  });

  it('planner-driven changes (time budget, eating out) are no taste signals', () => {
    const s = state({ plannedMeals: [meal('m', 'oven-salmon')] });
    const r = applyWeekChange(s, { type: 'setDayContext', date: '2026-09-21', context: { timeBudget: 'low', mode: 'eating_out' } }, new Date(2026, 8, 21, 9));
    expect(r.ok && r.state.learning.preferences).toEqual({});
  });

  it('finishing a workout records the weekday and the hour', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    const w: Workout = { id: 'w', date: '2026-09-22', templateId: 'fb-a', name: 'A', startedAt: new Date(2026, 8, 22, 18, 5).toISOString(), status: 'in_progress', exercises: [] };
    store.commit(state({ workouts: [w] }));
    actions.finishWorkout('w');
    const prefs = store.getState().learning.preferences;
    expect(prefs[prefKey.weekday(1)]!.pos).toBe(1);
    expect(prefs[prefKey.hour(18)]!.pos).toBe(1);
  });

  it('skipping and moving a session through the cascade are recorded', () => {
    const s = state();
    const skip = applyWeekChange(s, { type: 'skipWorkout', slotId: '2026-09-21#1' }, new Date(2026, 8, 21, 9));
    expect(skip.ok && skip.state.learning.preferences[prefKey.weekday(2)]!.neg).toBe(1);
  });
});
