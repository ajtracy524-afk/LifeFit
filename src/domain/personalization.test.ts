import { describe, expect, it } from 'vitest';
import { getFood } from '../data/foods';
import { getRecipe } from '../data/recipes';
import { emptyState } from '../store/persistence';
import { purchaseCost } from './costs';
import { weekDays } from './dates';
import { affinityIndex, learnFromEvent, type LearningEvent, type Preferences } from './learning';
import { plannedMealMacros, recipeAllowed, sumMacros } from './nutrition';
import { effectivePrepMin, scoreWeek, seededRandom, suggestWeek } from './planner';
import type { AppState, NutritionProfile, PlannedMeal } from './types';
import { applyWeekChange, planMeals } from './week';

/**
 * Personalization, budget and priorities are weights in ONE week score –
 * never a second planner and never stronger than the hard rules.
 */

const target = { kcal: 2800, protein: 160, carbs: 330, fat: 80 };
const dates = weekDays('2026-09-21');
const omni: NutritionProfile = { diet: 'omnivore', excluded: [], slots: ['breakfast', 'snack', 'lunch', 'dinner'] };
const SEEDS = ['1', '2', '3', '4', '5', '6'];
type Extra = Partial<Parameters<typeof suggestWeek>[0]>;
const plan = (seed: string, extra: Extra = {}) =>
  suggestWeek({ dates, slots: (extra.profile ?? omni).slots, target, profile: omni, existing: [], random: seededRandom(seed), ...extra });
const all = (extra: Extra = {}) => SEEDS.map((s) => plan(s, extra));
const count = (plans: PlannedMeal[][], recipeId: string) => plans.flat().filter((m) => m.recipeId === recipeId).length;
const learned = (n: number, type: 'meal_eaten' | 'meal_skipped', recipeId: string) => {
  let p: Preferences = {};
  for (let i = 0; i < n; i++) p = learnFromEvent(p, { type, recipeId, slot: 'dinner', timeBudget: 'normal' } as LearningEvent, 'x');
  return affinityIndex(p);
};
const weekCost = (p: PlannedMeal[], pantry: Record<string, number> = {}) =>
  scoreWeek(dates.map((d) => ({ date: d, target, fixed: p.filter((m) => m.date === d), remainingKcal: 0, slots: [], picks: [], timeBudget: 'normal' as const })), pantry).costChf;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('personalization in the planner', () => {
  it('one event changes the plan only minimally', () => {
    // Ingredient overlap (F3) plans a dish in pairs, so a near-tie flips by 2.
    // Minimal = at most one of the weeks reacts, and by at most one pair.
    const before = all().map((p) => count([p], 'lentil-dal'));
    const after = all({ affinity: learned(1, 'meal_eaten', 'lentil-dal') }).map((p) => count([p], 'lentil-dal'));
    const changed = before.map((b, i) => Math.abs(after[i]! - b)).filter((d) => d > 0);
    expect(changed.length).toBeLessThanOrEqual(1);
    expect(Math.max(0, ...changed)).toBeLessThanOrEqual(2);
  });

  it('repeatedly eaten recipes come more often', () => {
    expect(count(all({ affinity: learned(10, 'meal_eaten', 'lentil-dal') }), 'lentil-dal')).toBeGreaterThan(count(all(), 'lentil-dal'));
  });

  it('repeatedly skipped recipes come less often', () => {
    const base = count(all(), 'tofu-stir-fry');
    expect(count(all({ affinity: learned(10, 'meal_skipped', 'tofu-stir-fry') }), 'tofu-stir-fry')).toBeLessThan(base);
  });

  it('a liked recipe never breaks the variety cap or the calorie target', () => {
    for (const p of all({ affinity: learned(20, 'meal_eaten', 'lentil-dal') })) {
      expect(count([p], 'lentil-dal')).toBeLessThanOrEqual(3);
      for (const d of dates) expect(Math.abs(sumMacros(p.filter((m) => m.date === d).map(plannedMealMacros)).kcal - 2800) / 2800).toBeLessThan(0.1);
    }
  });
});

describe('hard rules beat anything learned', () => {
  const love = (recipeId: string) => learned(30, 'meal_eaten', recipeId);

  it('an explicit dislike beats a loved recipe', () => {
    const noChicken: NutritionProfile = { ...omni, dislikedFoods: ['chicken'] };
    for (const p of all({ profile: noChicken, affinity: love('chicken-rice-bowl') })) {
      expect(p.every((m) => !getRecipe(m.recipeId)!.ingredients.some((i) => i.foodId === 'chicken'))).toBe(true);
    }
  });

  it('an allergen exclusion beats a loved recipe', () => {
    const noFish: NutritionProfile = { ...omni, excluded: ['fish'] };
    for (const p of all({ profile: noFish, affinity: love('oven-salmon') })) for (const m of p) expect(recipeAllowed(getRecipe(m.recipeId)!, noFish)).toBe(true);
  });

  it('the time budget beats a loved slow recipe on a busy day', () => {
    const lowThursday = (d: string) => (d === dates[3] ? ('low' as const) : ('normal' as const));
    for (const p of all({ affinity: love('oven-salmon'), timeBudgetFor: lowThursday })) {
      expect(p.some((m) => m.date === dates[3] && m.recipeId === 'oven-salmon')).toBe(false);
    }
  });
});

describe('budget and estimated costs', () => {
  it('costs come from whole packages, not recipe grams', () => {
    // 180 g chicken → one 400 g pack at ~28 CHF/kg (Swiss estimate).
    expect(purchaseCost(getFood('chicken')!, 180)).toBeCloseTo(11.2);
    // No price known → unknown, not zero.
    expect(purchaseCost(getFood('whey')!, 30)).toBeUndefined();
  });

  it('the pantry lowers the estimated cost', () => {
    const p = plan('1');
    expect(weekCost(p, { rice: 5000, chicken: 5000, oats: 5000 })).toBeLessThan(weekCost(p));
  });

  it('"Sparen" plans cheaper weeks than "Ausgewogen" and keeps protein', () => {
    const balanced = avg(all().map((p) => weekCost(p)));
    const save = all({ priority: 'save' });
    expect(avg(save.map((p) => weekCost(p)))).toBeLessThan(balanced * 0.95);
    for (const p of save) for (const d of dates) expect(sumMacros(p.filter((m) => m.date === d).map(plannedMealMacros)).protein / 160).toBeGreaterThan(0.9);
  });

  it('under budget nothing changes; over budget the planner gets as close as it can', () => {
    const shape = (p: PlannedMeal[]) => p.map((m) => [m.date, m.slot, m.recipeId, m.servings]);
    expect(all({ budgetChf: 1000 }).map(shape)).toEqual(all().map(shape));
    const free = avg(all().map((p) => weekCost(p)));
    const tight = all({ budgetChf: 80 });
    expect(avg(tight.map((p) => weekCost(p)))).toBeLessThan(free);
    // Meals are not destroyed to save money: calories still fit.
    for (const p of tight) for (const d of dates) expect(Math.abs(sumMacros(p.filter((m) => m.date === d).map(plannedMealMacros)).kcal - 2800) / 2800).toBeLessThan(0.1);
  });

  it('"Protein" priority raises protein', () => {
    const protein = (plans: PlannedMeal[][]) => avg(plans.flatMap((p) => dates.map((d) => sumMacros(p.filter((m) => m.date === d).map(plannedMealMacros)).protein)));
    expect(protein(all({ priority: 'protein' }))).toBeGreaterThanOrEqual(protein(all()));
  });

  it('the meal after training gets more protein', () => {
    const snackProtein = (plans: PlannedMeal[][]) => avg(plans.flat().filter((m) => m.slot === 'snack').map((m) => plannedMealMacros(m).protein));
    expect(snackProtein(all({ postWorkoutSlotFor: () => 'snack' }))).toBeGreaterThan(snackProtein(all()));
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

describe('explicit dislike through the cascade', () => {
  const meals = (): PlannedMeal[] => [
    { id: 'a', date: '2026-09-22', slot: 'lunch', recipeId: 'chicken-rice-bowl', servings: 1, status: 'planned', source: 'suggest' },
    { id: 'b', date: '2026-09-23', slot: 'dinner', recipeId: 'chicken-wraps', servings: 1, status: 'planned', source: 'user' },
    { id: 'c', date: '2026-09-23', slot: 'lunch', recipeId: 'lentil-dal', servings: 1, status: 'planned', source: 'suggest' },
  ];

  it('"Mag ich nicht" replaces future planner meals with it, keeps own meals, undo-safe', () => {
    const s = state({ plannedMeals: meals() });
    const copy = structuredClone(s);
    const r = applyWeekChange(s, { type: 'setDislike', foodId: 'chicken', disliked: true }, new Date(2026, 8, 21, 9));
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.nutritionProfile!.dislikedFoods).toEqual(['chicken']);
    expect(r.state.plannedMeals.some((m) => m.id === 'a')).toBe(false);
    expect(r.state.plannedMeals.find((m) => m.id === 'b')!.recipeId).toBe('chicken-wraps'); // chosen by the user
    expect(r.state.plannedMeals.find((m) => m.id === 'c')!.recipeId).toBe('lentil-dal');
    expect(r.summary.replaced[0]!.from).toBe(getRecipe('chicken-rice-bowl')!.title);
    expect(s).toEqual(copy);
  });
});

describe('everything together through the central planner', () => {
  it('learned taste, pantry, budget, time budget and training all at once', () => {
    let prefs: Preferences = {};
    for (let i = 0; i < 8; i++) prefs = learnFromEvent(prefs, { type: 'meal_eaten', recipeId: 'lentil-dal', slot: 'lunch', timeBudget: 'normal' }, 'x');
    const s = state({
      learning: { preferences: prefs },
      pantry: { rice: { foodId: 'rice', quantityG: 1000, updatedAt: '2026-09-15T08:00:00Z' } },
      plannerSettings: { priority: 'balanced', weeklyBudgetChf: 90, mealTimes: { breakfast: '07:30', snack: '10:30', lunch: '12:30', dinner: '19:30' }, trainingTime: '18:00' },
      dayContexts: { '2026-09-24': { timeBudget: 'low', mode: 'normal' } },
    });
    const meals = planMeals(s, { dates, today: '2026-09-21', seed: 'all' });
    expect(meals).toHaveLength(21);
    const cooked = new Map<string, string[]>();
    meals.forEach((m) => cooked.set(m.recipeId, [...(cooked.get(m.recipeId) ?? []), m.date]));
    for (const m of meals.filter((x) => x.date === '2026-09-24')) expect(effectivePrepMin(getRecipe(m.recipeId)!, m.date, cooked, false)).toBeLessThanOrEqual(20);
    expect(meals.filter((m) => m.recipeId === 'lentil-dal').length).toBeGreaterThanOrEqual(1);
    for (const d of dates) {
      const kcal = sumMacros(meals.filter((m) => m.date === d).map(plannedMealMacros)).kcal;
      expect(kcal).toBeGreaterThan(2400);
    }
  });
});
