import { describe, expect, it } from 'vitest';
import { getRecipe } from '../data/recipes';
import { weekDays } from './dates';
import { plannedMealMacros, recipeAllowed, recipeMacros, sumMacros } from './nutrition';
import { scoreWeek, seededRandom, suggestWeek, type PlannerWeights, type PlanningDay } from './planner';
import type { NutritionProfile, PlannedMeal } from './types';

/**
 * F3 – ingredient overlap. The planner weighs the shopping a week causes
 * (foods to buy, opened perishable packages) against nutrition and variety.
 */

const target = { kcal: 2800, protein: 160, carbs: 330, fat: 80 };
const dates = weekDays('2026-09-21');
const omni: NutritionProfile = { diet: 'omnivore', excluded: [], slots: ['breakfast', 'snack', 'lunch', 'dinner'] };
const OVERLAP_OFF: Partial<PlannerWeights> = { newFood: 0, packageWaste: 0 };
const SEEDS = ['1', '2', '3', '4', '5'];

function plan(seed: string, opts: { weights?: Partial<PlannerWeights>; pantry?: Record<string, number>; existing?: PlannedMeal[]; profile?: NutritionProfile } = {}) {
  const profile = opts.profile ?? omni;
  return suggestWeek({
    dates,
    slots: profile.slots,
    target,
    profile,
    existing: opts.existing ?? [],
    pantry: opts.pantry,
    weights: opts.weights,
    random: seededRandom(seed),
  });
}

const foodsOf = (meals: PlannedMeal[]) => new Set(meals.flatMap((m) => getRecipe(m.recipeId)!.ingredients.map((i) => i.foodId)));
const dayTotals = (meals: PlannedMeal[], d: string) => sumMacros(meals.filter((m) => m.date === d).map(plannedMealMacros));
const mealsWith = (meals: PlannedMeal[], foodId: string) => meals.filter((m) => getRecipe(m.recipeId)!.ingredients.some((i) => i.foodId === foodId)).length;

/** A day with exactly one serving of each recipe (servings factor 1), so grams are the recipe grams. */
const day = (date: string, picks: string[]): PlanningDay => {
  const recipes = picks.map((id) => getRecipe(id)!);
  return {
    date,
    target: { ...target, protein: 1 },
    fixed: [],
    remainingKcal: recipes.reduce((s, r) => s + recipeMacros(r).kcal, 0),
    slots: picks.map(() => 'lunch' as const),
    picks: recipes,
  };
};

describe('F3 · ingredient overlap', () => {
  it('needs fewer different foods than planning without overlap', () => {
    const on = SEEDS.map((s) => foodsOf(plan(s)).size);
    const off = SEEDS.map((s) => foodsOf(plan(s, { weights: OVERLAP_OFF })).size);
    on.forEach((n, i) => expect(n).toBeLessThanOrEqual(off[i]!));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(on)).toBeLessThan(avg(off) * 0.85); // at least 15 % fewer items
  });

  it('keeps calories and protein – nutrition is not optimised away', () => {
    for (const seed of SEEDS) {
      const on = plan(seed);
      const off = plan(seed, { weights: OVERLAP_OFF });
      for (const d of dates) {
        expect(Math.abs(dayTotals(on, d).kcal - target.kcal) / target.kcal).toBeLessThan(0.1);
        expect(dayTotals(on, d).protein / target.protein).toBeGreaterThan(0.9);
      }
      const avgProtein = (meals: PlannedMeal[]) => dates.reduce((s, d) => s + dayTotals(meals, d).protein, 0) / dates.length;
      expect(avgProtein(on)).toBeGreaterThan(avgProtein(off) * 0.95);
    }
  });

  it('keeps variety: no recipe more than 3× a week, rarely the same slot on consecutive days', () => {
    for (const seed of SEEDS) {
      const meals = plan(seed);
      const uses = new Map<string, number>();
      meals.forEach((m) => uses.set(m.recipeId, (uses.get(m.recipeId) ?? 0) + 1));
      expect(Math.max(...uses.values())).toBeLessThanOrEqual(3);
      expect(uses.size).toBeGreaterThanOrEqual(meals.length / 2);
      // Soft rule: a prepped breakfast twice in a row may happen, but not more than once a week.
      let consecutive = 0;
      for (let i = 1; i < dates.length; i++) {
        for (const slot of omni.slots) {
          const a = meals.find((m) => m.date === dates[i - 1] && m.slot === slot)?.recipeId;
          if (a && a === meals.find((m) => m.date === dates[i] && m.slot === slot)?.recipeId) consecutive++;
        }
      }
      expect(consecutive).toBeLessThanOrEqual(1);
    }
  });

  it('scores the week as a whole: shared ingredients and fuller packages are cheaper', () => {
    // Foods are counted once per WEEK: chicken and oil of the bowl (Mon) and the
    // sweet potato dish (Tue) are one item each on the shopping list.
    const ingredients = (id: string) => getRecipe(id)!.ingredients.map((i) => i.foodId);
    const week = scoreWeek([day(dates[0]!, ['chicken-rice-bowl']), day(dates[1]!, ['chicken-sweet-potato'])]);
    const union = new Set([...ingredients('chicken-rice-bowl'), ...ingredients('chicken-sweet-potato')]);
    expect(week.foodsToBuy.sort()).toEqual([...union].sort());
    expect(week.foodsToBuy.length).toBeLessThan(ingredients('chicken-rice-bowl').length + ingredients('chicken-sweet-potato').length);
    // What is in the pantry is not bought again.
    expect(scoreWeek([day(dates[0]!, ['chicken-rice-bowl'])], { chicken: 1000 }).foodsToBuy).not.toContain('chicken');
    // 180 g chicken leaves 220 g of the 400 g pack; twice (360 g) almost empties it.
    const once = scoreWeek([day(dates[0]!, ['chicken-rice-bowl'])]);
    const twice = scoreWeek([day(dates[0]!, ['chicken-rice-bowl']), day(dates[1]!, ['chicken-rice-bowl'])]);
    expect(twice.packageWaste).toBeLessThan(once.packageWaste);
  });

  it('reuses ingredients of meals the user already planned', () => {
    const existing: PlannedMeal[] = [
      { id: 'u1', date: dates[0]!, slot: 'dinner', recipeId: 'oven-salmon', servings: 1, status: 'planned', source: 'user' },
    ];
    const withUserMeal = plan('7', { existing });
    // The user's meal stays untouched and is not duplicated.
    expect(withUserMeal.some((m) => m.date === dates[0] && m.slot === 'dinner')).toBe(false);
    const foods = foodsOf([...existing, ...withUserMeal]);
    const baseline = foodsOf([...existing, ...plan('7', { existing, weights: OVERLAP_OFF })]);
    expect(foods.size).toBeLessThanOrEqual(baseline.size);
  });

  it('prefers what is in the pantry', () => {
    const pantry = { salmon: 500, potato: 1500, broccoli: 500 };
    for (const seed of SEEDS) {
      const without = plan(seed);
      const withPantry = plan(seed, { pantry });
      expect(mealsWith(withPantry, 'salmon')).toBeGreaterThanOrEqual(mealsWith(without, 'salmon'));
    }
    const total = (p?: Record<string, number>) => SEEDS.reduce((s, seed) => s + mealsWith(plan(seed, { pantry: p }), 'salmon'), 0);
    expect(total(pantry)).toBeGreaterThan(total());
  });

  it('still respects diet exclusions as a hard filter', () => {
    const vegan: NutritionProfile = { ...omni, diet: 'vegan', excluded: ['gluten'] };
    for (const seed of SEEDS) for (const m of plan(seed, { profile: vegan })) expect(recipeAllowed(getRecipe(m.recipeId)!, vegan)).toBe(true);
  });

  it('is reproducible with the same seed', () => {
    const shape = (meals: PlannedMeal[]) => meals.map((m) => [m.date, m.slot, m.recipeId, m.servings]);
    expect(shape(plan('2026-09-21'))).toEqual(shape(plan('2026-09-21')));
    expect(shape(plan('2026-09-21'))).not.toEqual(shape(plan('2026-09-28')));
  });
});
