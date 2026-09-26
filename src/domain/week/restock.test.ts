import { describe, expect, it } from 'vitest';
import { RESTOCK_MINIMUM_G } from '../../data/basics';
import { getRecipe } from '../../data/recipes';
import { emptyState } from '../../store/persistence';
import { logFromMeal } from '../nutrition';
import { activeWorkouts } from '../training';
import type { AppState, PlannedMeal } from '../types';
import { applyWeekChange, type CascadeResult } from './cascade';
import { dayTargetFor } from './dayTargets';
import { pantryEstimate } from './pantry';
import { weekShopping } from './weekPlan';

/**
 * F8 – restock of basics: plan need + minimum stock − pantry, one position per
 * food, on the normal shopping list. No second list, no second pantry.
 */

const MON = '2026-09-21';
const NEXT = '2026-09-28';
const NOW = new Date(2026, 8, 21, 8, 0);
const OATS_MIN = RESTOCK_MINIMUM_G.oats!; // 300 g
const RICE_MIN = RESTOCK_MINIMUM_G.rice!; // 400 g

function state(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: `${MON}T07:00:00Z` },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: MON },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: MON, method: 'formula', kcal: 2800, protein: 160, carbs: 330, fat: 80 }],
    training: { programId: 'full-body', weekdays: [0, 2, 4] },
    weights: [{ id: 'w', date: MON, kg: 80 }],
    ...patch,
  };
}
const pantry = (entries: Record<string, number>) =>
  Object.fromEntries(Object.entries(entries).map(([foodId, g]) => [foodId, { foodId, quantityG: g, updatedAt: `${MON}T06:00:00Z` }]));
const ok = (r: CascadeResult) => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
const item = (s: AppState, foodId: string, week = MON) => weekShopping(s, week, MON).find((i) => i.foodId === foodId);
const riceBowls = (grams: number): PlannedMeal => ({
  id: 'bowl',
  date: '2026-09-24',
  slot: 'dinner',
  recipeId: 'chicken-rice-bowl',
  servings: grams / 80,
  status: 'planned',
  source: 'suggest',
});

describe('F8 · basics below / at / above the minimum', () => {
  it('below the minimum → on the list as restock', () => {
    const i = item(state({ pantry: pantry({ oats: 200 }) }), 'oats')!;
    expect(i.state).toBe('open');
    expect(i.remainingG).toBe(OATS_MIN - 200);
    expect(i.restockG).toBe(OATS_MIN - 200);
    expect(i.sources).toHaveLength(0);
  });

  it('exactly at and above the minimum → not on the list', () => {
    expect(item(state({ pantry: pantry({ oats: OATS_MIN }) }), 'oats')).toBeUndefined();
    expect(item(state({ pantry: pantry({ oats: OATS_MIN + 200 }) }), 'oats')).toBeUndefined();
  });

  it('"Ist aufgebraucht" (0 g) keeps the basic known – it is restocked', () => {
    const s = ok(applyWeekChange(state({ pantry: pantry({ oats: 500 }) }), { type: 'setPantry', foodId: 'oats', quantityG: 0 }, NOW));
    expect(pantryEstimate(s).oats).toBe(0);
    expect(item(s, 'oats')!.remainingG).toBe(OATS_MIN);
  });

  it('a basic the user never keeps is not restocked; non-basics never are', () => {
    expect(item(state(), 'oats')).toBeUndefined();
    expect(item(state({ pantry: pantry({ 'soy-sauce': 0, salmon: 0 }) }), 'soy-sauce')).toBeUndefined();
    expect(item(state({ pantry: pantry({ salmon: 0 }) }), 'salmon')).toBeUndefined();
  });

  it('the diet decides: no milk restock for a vegan profile', () => {
    const vegan = state({ nutritionProfile: { diet: 'vegan', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] }, pantry: pantry({ milk: 0, oats: 0 }) });
    expect(item(vegan, 'milk')).toBeUndefined();
    expect(item(vegan, 'oats')).toBeDefined();
  });

  it('only the list of the current week restocks (the next shopping trip)', () => {
    expect(item(state({ pantry: pantry({ oats: 0 }) }), 'oats', NEXT)).toBeUndefined();
  });
});

describe('F8 · plan need + minimum − pantry = ONE position', () => {
  it('500 g needed, 200 g at home, minimum 400 g → 700 g to buy, not 500 + 400', () => {
    const s = state({ plannedMeals: [riceBowls(500)], pantry: pantry({ rice: 200 }) });
    const rice = weekShopping(s, MON, MON).filter((i) => i.foodId === 'rice');
    expect(rice).toHaveLength(1);
    expect(rice[0]!.neededG).toBeCloseTo(500);
    expect(rice[0]!.remainingG).toBeCloseTo(500 + RICE_MIN - 200);
    expect(rice[0]!.restockG).toBeCloseTo(RICE_MIN);
    expect(rice[0]!.sources).toHaveLength(1);
  });

  it('enough for plan and minimum → nothing to buy', () => {
    const s = state({ plannedMeals: [riceBowls(500)], pantry: pantry({ rice: 500 + RICE_MIN }) });
    expect(item(s, 'rice')!.state).toBe('have');
  });

  it('buying credits whole packages; the item is done and the restock gone', () => {
    let s = state({ pantry: pantry({ oats: 100 }) });
    s = ok(applyWeekChange(s, { type: 'purchase', week: MON, foodId: 'oats' }, NOW));
    expect(pantryEstimate(s).oats).toBe(600); // 100 + one 500 g pack
    expect(item(s, 'oats')!.state).toBe('checked');
    expect(item(s, 'oats')!.remainingG).toBe(0);
  });

  it('a correction above the minimum removes it; "diese Woche nicht" hides it for this week only', () => {
    const s = state({ pantry: pantry({ oats: 100 }) });
    expect(item(ok(applyWeekChange(s, { type: 'setPantry', foodId: 'oats', quantityG: 400 }, NOW)), 'oats')).toBeUndefined();
    const skipped = ok(applyWeekChange(s, { type: 'skipRestock', week: MON, foodId: 'oats' }, NOW));
    expect(item(skipped, 'oats')).toBeUndefined();
    expect(skipped.shopping[MON]!.restockSkipped).toEqual(['oats']);
    // The plan need of a skipped basic is still bought.
    const planned = ok(applyWeekChange(state({ plannedMeals: [riceBowls(300)], pantry: pantry({ rice: 0 }) }), { type: 'skipRestock', week: MON, foodId: 'rice' }, NOW));
    expect(item(planned, 'rice')!.remainingG).toBeCloseTo(300);
  });

  it('eating reduces the pantry and can bring the restock back', () => {
    const oatsPerServing = getRecipe('overnight-oats')!.ingredients.find((i) => i.foodId === 'oats')!.grams; // 70 g
    let s = state({ pantry: pantry({ oats: OATS_MIN + 20 }) });
    expect(item(s, 'oats')).toBeUndefined();
    const breakfast: PlannedMeal = { id: 'b', date: MON, slot: 'breakfast', recipeId: 'overnight-oats', servings: 1, status: 'eaten', source: 'suggest' };
    s = { ...s, plannedMeals: [breakfast], logEntries: [logFromMeal(breakfast, `${MON}T08:00:00Z`)] };
    expect(pantryEstimate(s).oats).toBe(OATS_MIN + 20 - oatsPerServing);
    expect(item(s, 'oats')!.remainingG).toBe(oatsPerServing - 20);
  });
});

describe('F8 · undo and independence from planning', () => {
  it('purchase, correction and skip leave the previous state untouched (undo)', () => {
    const s = state({ plannedMeals: [riceBowls(300)], pantry: pantry({ rice: 100, oats: 50 }) });
    const copy = structuredClone(s);
    ok(applyWeekChange(s, { type: 'purchase', week: MON, foodId: 'rice' }, NOW));
    ok(applyWeekChange(s, { type: 'setPantry', foodId: 'oats', quantityG: 900 }, NOW));
    ok(applyWeekChange(s, { type: 'skipRestock', week: MON, foodId: 'oats' }, NOW));
    expect(s).toEqual(copy);
  });

  it('restock never changes meals, training or targets (planner, F3 and F5 untouched)', () => {
    const plan = { type: 'planWeek' as const, week: MON, trainingDays: [0, 2, 4], days: { '2026-09-24': { timeBudget: 'low' as const, mode: 'normal' as const } } };
    const low = ok(applyWeekChange(state({ pantry: pantry({ oats: 0, rice: 0, egg: 0 }) }), plan, NOW));
    const full = ok(applyWeekChange(state({ pantry: pantry({ oats: 5000, rice: 5000, egg: 5000 }) }), { ...plan }, NOW));
    const shape = (s: AppState) => s.plannedMeals.map((m) => [m.date, m.slot, m.recipeId, m.servings]);
    // Same pantry-independent parts: training and targets identical; meals may use stock (F2), never forced by restock.
    expect(activeWorkouts(low.training, low.workoutOverrides, [], MON, low.dayContexts).map((w) => [w.date, w.template.name])).toEqual(
      activeWorkouts(full.training, full.workoutOverrides, [], MON, full.dayContexts).map((w) => [w.date, w.template.name]),
    );
    expect(dayTargetFor(low, '2026-09-24')!.kcal).toBe(dayTargetFor(full, '2026-09-24')!.kcal);
    // Skipping a restock does not re-plan anything.
    const skipped = ok(applyWeekChange(low, { type: 'skipRestock', week: MON, foodId: 'oats' }, NOW));
    expect(shape(skipped)).toEqual(shape(low));
  });
});
