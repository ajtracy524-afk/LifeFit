import { describe, expect, it } from 'vitest';
import { FOODS, getFood } from '../data/foods';
import { allRecipes, getRecipe } from '../data/recipes';
import { emptyState } from '../store/persistence';
import { feasibility, fitsDiet, hardExclusionsOf, isExcluded, matchCatalog, recipeTags, substituteFood, swapContextOf, usableFood } from './catalogTags';
import { MIN_RECIPES_PER_SLOT } from './constants';
import { weekDays } from './dates';
import { nutritionProfileFrom, plannerSettingsFrom } from './onboarding/food';
import { foodAllowed, plannedMealMacros, recipeAllowed, sumMacros } from './nutrition';
import { effectivePrepMin, isLeftover, recipesForSlot, seededRandom, slotShare, suggestWeek } from './planner';
import { buildShoppingList } from './shopping';
import { maxPrepFor } from './timeBudget';
import type { Diet } from './catalogTags';
import type { AppState, Food, Intolerance, LmivAllergen, MealSlot, NutritionProfile, PlannedMeal } from './types';
import { addMissingMealTimes } from '../store/persistence';
import { weekShopping } from './week';

/** Prompt 4 – area B: hard exclusions, preferences, everyday life, and how the planner uses them. */

const target = { kcal: 2600, protein: 150, carbs: 300, fat: 80 };
const dates = weekDays('2026-10-05');
const dayTotals = (meals: PlannedMeal[], date: string) => sumMacros(meals.filter((m) => m.date === date).map(plannedMealMacros));
const SLOTS: MealSlot[] = ['breakfast', 'snack', 'lunch', 'dinner'];
const base: NutritionProfile = { diet: 'omnivore', excluded: [], slots: SLOTS };
const plan = (profile: NutritionProfile, seed: string, extra: Partial<Parameters<typeof suggestWeek>[0]> = {}) =>
  suggestWeek({ dates, slots: profile.slots, target, profile, existing: [], random: seededRandom(seed), ...extra });

const ALL_ALLERGENS: LmivAllergen[] = ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'tree_nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'];
const DIETS: Diet[] = ['omnivore', 'pescatarian', 'vegetarian', 'vegan'];
const INTOL: Intolerance[] = ['lactose', 'fructose', 'celiac'];

/** A random but reproducible profile. */
function randomProfile(seed: number): NutritionProfile {
  const r = seededRandom(`profile-${seed}`);
  const pick = <T,>(xs: T[], p: number) => xs.filter(() => r() < p);
  const allergens = pick(ALL_ALLERGENS, 0.15);
  return {
    ...base,
    diet: DIETS[Math.floor(r() * DIETS.length)]!,
    allergens,
    tracesOk: allergens.filter(() => r() < 0.3),
    intolerances: pick(INTOL, 0.2),
    ...(r() < 0.3 ? { noPork: true as const } : {}),
    ...(r() < 0.3 ? { noAlcohol: true as const } : {}),
    ...(r() < 0.2 ? { fermentationAlcoholOk: true as const } : {}),
    // The old list is merged too (E5).
    excluded: r() < 0.2 ? ['nuts'] : [],
  };
}

describe('hard exclusions never reach the plan or the shopping list (property test)', () => {
  it('for 60 random profiles: no excluded allergen, no diet violation – in the week plan and on the shopping list', () => {
    for (let i = 0; i < 60; i++) {
      const profile = randomProfile(i);
      const ex = hardExclusionsOf(profile);
      const meals = plan(profile, `p${i}`);
      for (const m of meals) {
        const recipe = getRecipe(m.recipeId)!;
        for (const ing of recipe.ingredients) expect(usableFood(ing.foodId, ex), `profile ${i}: ${recipe.id} / ${ing.foodId}`).toBeDefined();
        expect(fitsDiet(recipeTags(recipe).kinds, profile.diet), `profile ${i}: ${recipe.id} diet`).toBe(true);
      }
      const swap = swapContextOf(ex);
      for (const item of buildShoppingList(meals, dates[0]!, dates[6]!, (id) => substituteFood(id, swap))) {
        const bought = getFood(item.buyFoodId ?? item.foodId)!;
        expect(isExcluded(bought, ex), `profile ${i}: buys ${bought.id}`).toBe(false);
        expect(bought.tags!.allergens.some((a) => ex.allergens!.includes(a)), `profile ${i}: allergen in ${bought.id}`).toBe(false);
        expect(fitsDiet(bought.tags!.kinds, profile.diet), `profile ${i}: diet ${bought.id}`).toBe(true);
      }
    }
  });

  it('the old "Nüsse" exclusion keeps peanuts, tree nuts and their traces out (E5)', () => {
    const old: NutritionProfile = { ...base, excluded: ['nuts', 'lactose'] };
    expect(hardExclusionsOf(old)).toMatchObject({ allergens: ['peanuts', 'tree_nuts'], intolerances: ['lactose'] });
    expect(foodAllowed(getFood('peanut-butter')!, old)).toBe(false);
    expect(foodAllowed(getFood('protein-bar')!, old)).toBe(false); // nuts as traces
    expect(recipeAllowed(getRecipe('protein-pancakes')!, old)).toBe(true); // quark → lactose-free
  });

  it('own products: only declared facts exclude, nothing is guessed', () => {
    const own = (patch: Partial<Food>): Food => ({ id: 'product:1', name: 'Müsliriegel Haselnuss', category: 'pantry', per100: { kcal: 400, protein: 8, carbs: 60, fat: 15 }, vegan: false, vegetarian: false, allergens: [], dietUnknown: { vegan: true, vegetarian: true }, ...patch });
    expect(isExcluded(own({}), { allergens: ['soy'] })).toBe(false); // unknown
    expect(isExcluded(own({ declared: { allergens: ['soy'], traces: [] } }), { allergens: ['soy'] })).toBe(true);
    expect(isExcluded(own({ declared: { allergens: [], traces: ['peanuts'] } }), { allergens: ['peanuts'] })).toBe(true);
    expect(isExcluded(own({ declared: { allergens: [], traces: ['peanuts'] } }), { allergens: ['peanuts'], tracesOk: ['peanuts'] })).toBe(false);
    expect(isExcluded(own({ allergens: ['lactose'] }), { allergens: ['milk'] })).toBe(true); // old flag read strictly
    expect(isExcluded(own({}), { texts: ['Haselnuss'] })).toBe(true); // free text against the name
    expect(isExcluded(own({ dietUnknown: undefined }), { diet: 'pescatarian' })).toBe(true); // known: not vegetarian
  });
});

describe('free text and feasibility', () => {
  it('matches the free text against the catalog, keeps the rest as text', () => {
    const m = matchCatalog(['Zwiebel', 'Pilze', 'Ei', ' '], FOODS);
    expect(m.foods).toEqual(['onion']);
    expect(m.unmatched).toEqual(['Pilze', 'Ei']); // "Ei" is too short to match safely
    const np = nutritionProfileFrom({ customExclusions: { value: ['Zwiebel', 'Pilze'], source: 'user', updatedAt: '' } }, base);
    expect(np.excludedFoods).toEqual(['onion']);
    expect(np.excludedText).toEqual(['Pilze']);
    expect(recipeAllowed(getRecipe('chili')!, np)).toBe(false);
  });

  it('too few recipes per meal → not ok, with one suggestion that helps', () => {
    const veganSoy = hardExclusionsOf({ ...base, diet: 'vegan', allergens: ['soy'] });
    const f = feasibility(veganSoy, SLOTS, allRecipes(), MIN_RECIPES_PER_SLOT);
    expect(f.ok).toBe(false);
    expect(f.counts.breakfast).toBe(0);
    expect(f.suggestion).toMatchObject({ change: { kind: 'diet', diet: 'vegetarian' } });
    const min = (c: Partial<Record<MealSlot, number>>) => Math.min(...SLOTS.map((s) => c[s] ?? 0));
    expect(min(f.suggestion!.counts)).toBeGreaterThan(min(f.counts));
    expect(feasibility(hardExclusionsOf(base), SLOTS, allRecipes(), MIN_RECIPES_PER_SLOT).ok).toBe(true);
    // Traces and alcohol from fermentation are suggested when they are the bottleneck.
    const nuts = feasibility({ allergens: ['tree_nuts'], alcohol: true }, ['snack'], allRecipes(), 6);
    expect(nuts.suggestion?.change.kind).toMatch(/traces|fermentation/);
  });
});

describe('preferences are weights, not filters (E23)', () => {
  it('a disliked food does not appear while there are alternatives', () => {
    const noChicken: NutritionProfile = { ...base, dislikedFoods: ['chicken', 'egg'] };
    for (const seed of ['1', '2', '3', '4', '5', '6']) {
      for (const m of plan(noChicken, seed)) expect(getRecipe(m.recipeId)!.ingredients.some((i) => ['chicken', 'egg'].includes(i.foodId)), m.recipeId).toBe(false);
    }
  });

  it('…and is planned as a last resort instead of leaving the meal empty', () => {
    // Vegan snacks: apple with peanut butter and edamame – both disliked.
    const vegan: NutritionProfile = { ...base, diet: 'vegan', dislikedFoods: ['apple', 'edamame'] };
    expect(recipesForSlot('snack', vegan).every((r) => r.ingredients.some((i) => ['apple', 'edamame'].includes(i.foodId)))).toBe(true);
    const snacks = plan(vegan, '1').filter((m) => m.slot === 'snack');
    expect(snacks).toHaveLength(7);
  });

  it('liked foods come a little more often', () => {
    const count = (p: NutritionProfile) => ['1', '2', '3', '4', '5', '6'].reduce((n, s) => n + plan(p, s).filter((m) => getRecipe(m.recipeId)!.ingredients.some((i) => i.foodId === 'salmon')).length, 0);
    expect(count({ ...base, likedFoods: ['salmon'] })).toBeGreaterThan(count(base));
  });
});

describe('everyday life', () => {
  it('cooking time: weekday / weekend, "Wenig Zeit" caps, "Viel Zeit" lifts, no answer = 35 min as before (E13)', () => {
    const settings = { cookingTime: { weekday: '15' as const, weekend: 'any' as const } };
    expect(maxPrepFor(settings, undefined, '2026-10-05')).toBe(15); // Monday
    expect(maxPrepFor(settings, undefined, '2026-10-10')).toBe(Number.POSITIVE_INFINITY); // Saturday
    expect(maxPrepFor({ cookingTime: { weekday: '45', weekend: '45' } }, { timeBudget: 'low', mode: 'normal' }, '2026-10-05')).toBe(15);
    expect(maxPrepFor(settings, { timeBudget: 'high', mode: 'normal' }, '2026-10-05')).toBe(Number.POSITIVE_INFINITY);
    expect(maxPrepFor(undefined, undefined, '2026-10-05')).toBe(35);
  });

  it('the cooking time holds whenever recipes fit it', () => {
    for (const seed of ['1', '2', '3']) {
      const meals = plan(base, seed, { maxPrepFor: () => 15 });
      for (const m of meals) expect(getRecipe(m.recipeId)!.prepMin, m.recipeId).toBeLessThanOrEqual(15);
    }
  });

  it('meal prep bundles: leftovers only for "Ich koche gern vor"', () => {
    const leftovers = (mealPrep: boolean) =>
      ['1', '2', '3', '4'].reduce((n, seed) => {
        const meals = plan(base, seed, { mealPrep });
        const cooked = new Map<string, string[]>();
        meals.forEach((m) => cooked.set(m.recipeId, [...(cooked.get(m.recipeId) ?? []), m.date]));
        return n + meals.filter((m) => isLeftover(getRecipe(m.recipeId)!, m.date, cooked)).length;
      }, 0);
    const on = leftovers(true);
    expect(on).toBeGreaterThan(leftovers(false));
    expect(on).toBeGreaterThanOrEqual(4); // at least one bundled leftover per week on average
    expect(effectivePrepMin(getRecipe('chili')!, '2026-10-06', new Map([['chili', ['2026-10-05']]]), false)).toBe(35);
  });

  it('household size scales only the shopping amounts – not the meals or the nutrition', () => {
    const meals = plan(base, '1');
    const one = buildShoppingList(meals, dates[0]!, dates[6]!);
    const three = buildShoppingList(meals, dates[0]!, dates[6]!, undefined, 3);
    for (const item of one) expect(three.find((i) => i.foodId === item.foodId)!.grams).toBeCloseTo(item.grams * 3, 6);

    const state = (householdSize?: number): AppState => ({
      ...emptyState(),
      nutritionProfile: base,
      targets: [{ id: 't', validFrom: '2026-01-01', method: 'formula', ...target }],
      plannedMeals: meals,
      plannerSettings: { ...emptyState().plannerSettings, ...(householdSize ? { householdSize } : {}) },
    });
    const solo = weekShopping(state(), dates[0]!, dates[0]!);
    const family = weekShopping(state(3), dates[0]!, dates[0]!);
    expect(family.reduce((s, i) => s + i.neededG, 0)).toBeCloseTo(solo.reduce((s, i) => s + i.neededG, 0) * 3, 0);
    for (const d of dates) expect(dayTotals(state(3).plannedMeals, d)).toEqual(dayTotals(state().plannedMeals, d));
  });

  it('answers → nutrition profile and planner settings', () => {
    const at = '2026-10-02T08:00:00Z';
    const f = <T,>(value: T) => ({ value, source: 'user' as const, updatedAt: at });
    const np = nutritionProfileFrom(
      {
        diet: f('pescatarian' as const),
        allergens: f(['soy', 'eggs'] as LmivAllergen[]),
        tracesOk: f(['soy', 'milk'] as LmivAllergen[]),
        intolerances: f(['fructose'] as Intolerance[]),
        exclusions: f(['pork', 'alcohol'] as ('pork' | 'alcohol')[]),
        preferences: f({ salmon: 'like' as const, tofu: 'dislike' as const }),
        meals: f(['dinner', 'breakfast', 'snack2'] as MealSlot[]),
      },
      { ...base, excluded: ['nuts'] },
    );
    expect(np).toMatchObject({ diet: 'pescatarian', excluded: [], allergens: ['soy', 'eggs'], tracesOk: ['soy'], intolerances: ['fructose'], noPork: true, noAlcohol: true, likedFoods: ['salmon'], dislikedFoods: ['tofu'], slots: ['breakfast', 'snack2', 'dinner'] });
    const ps = plannerSettingsFrom({ budget: f('low' as const), householdSize: f(12), cookingTime: f({ weekday: '30' as const, weekend: '45' as const }) }, emptyState().plannerSettings);
    expect(ps).toMatchObject({ priority: 'save', householdSize: 8, cookingTime: { weekday: '30', weekend: '45' } });
    expect(plannerSettingsFrom({ budget: f('any' as const) }, { ...ps }).priority).toBe('balanced');
    expect(plannerSettingsFrom({ budget: f('medium' as const) }, { ...ps, priority: 'protein' }).priority).toBe('protein');
  });
});

describe('Snack 2 (E13)', () => {
  it('uses the snack recipes, gets its share of the day and a default time', () => {
    expect(recipesForSlot('snack2', base).map((r) => r.id)).toEqual(recipesForSlot('snack', base).map((r) => r.id));
    expect(slotShare(['snack2'], ['breakfast', 'snack', 'lunch', 'snack2', 'dinner'])).toBeGreaterThan(0.08);
    const five: NutritionProfile = { ...base, slots: ['breakfast', 'snack', 'lunch', 'snack2', 'dinner'] };
    const meals = plan(five, '1');
    expect(meals.filter((m) => m.slot === 'snack2')).toHaveLength(7);
    for (const d of dates) expect(Math.abs(dayTotals(meals, d).kcal - target.kcal) / target.kcal).toBeLessThan(0.1);
    const old = { ...emptyState(), plannerSettings: { priority: 'balanced' as const, mealTimes: { breakfast: '07:00', snack: '10:00', lunch: '12:00', dinner: '18:30' } as AppState['plannerSettings']['mealTimes'] } };
    expect(addMissingMealTimes(old).plannerSettings.mealTimes).toEqual({ breakfast: '07:00', snack: '10:00', lunch: '12:00', snack2: '16:00', dinner: '18:30' });
  });
});
