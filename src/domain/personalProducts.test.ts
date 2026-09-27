import { afterEach, describe, expect, it } from 'vitest';
import { getFood } from '../data/foods';
import { allRecipes, getRecipe, RECIPES } from '../data/recipes';
import { emptyState } from '../store/persistence';
import { formatChf, priceLookup, recipeCostRange } from './costs';
import { weekDays } from './dates';
import { dishCostRange, dishEntry, dishPortionNutrition, draftFromEntries, ingredientFromFood, ingredientFromProduct } from './dishes';
import { explainMeal } from './explain';
import { recipeAllowed, recipeMacros, recipeMicros } from './nutrition';
import { dishAsRecipe, isPlannable, syncPersonal } from './personal';
import type { AppState, CustomDish, LogEntry, PlannedMeal, Product } from './types';
import { applyWeekChange, planMeals, weekFoodCost, weekShopping } from './week';

/**
 * Own products and own dishes join the EXISTING systems: getFood / getRecipe,
 * the planner's candidates (recipesForSlot → scoreWeek), shopping, pantry,
 * prices and budget – no second planner, list or price logic.
 */

const MON = '2026-09-21';
const oats: Product = {
  barcode: '7610000000011',
  name: 'Haferflocken',
  brand: 'M-Classic',
  per100: { kcal: 370, protein: 13, carbs: 59, fat: 7 },
  micros100: { fiber: 10, sugar: 1, salt: 0.01 },
  unit: 'g',
  packageSize: 500,
  price: { chf: 1.19, amount: 500, at: `${MON}T08:00:00Z` },
  source: 'openfoodfacts',
  fetchedAt: `${MON}T08:00:00Z`,
};
const dish = (patch: Partial<CustomDish> = {}): CustomDish => ({
  id: 'porridge',
  name: 'Protein-Porridge',
  portions: 2,
  ingredients: [ingredientFromProduct(oats, 160, 'a')!, ingredientFromFood(getFood('skyr')!, 400, 'b'), ingredientFromFood(getFood('banana')!, 240, 'c')],
  slots: ['breakfast'],
  prepMin: 5,
  createdAt: MON,
  updatedAt: MON,
  ...patch,
});
const base = (patch: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'intermediate', createdAt: '2026-08-01T08:00:00' },
  goal: { type: 'maintain', startWeightKg: 80, startedAt: '2026-08-01' },
  nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
  targets: [{ id: 't', validFrom: '2026-01-01', method: 'formula', kcal: 2400, protein: 150, carbs: 280, fat: 75 }],
  training: null,
  products: { [oats.barcode]: oats },
  customDishes: { porridge: dish() },
  ...patch,
});
afterEach(() => syncPersonal(emptyState()));

describe('registry: own products and dishes are known like catalog entries', () => {
  it('a product becomes a food with its values, pack and real CHF price', () => {
    syncPersonal(base());
    expect(getFood('product:7610000000011')).toMatchObject({ name: 'Haferflocken (M-Classic)', per100: { kcal: 370, protein: 13 }, packageG: 500, estPricePerKg: 2.38 });
    expect(priceLookup(base().products)('product:7610000000011')).toEqual({ perKgChf: 2.38, exact: true });
  });

  it('a dish with meal slots and complete values becomes a planner candidate – per portion', () => {
    syncPersonal(base());
    const r = getRecipe('dish:porridge')!;
    expect(r).toMatchObject({ title: 'Protein-Porridge', slots: ['breakfast'], prepMin: 5, personal: true });
    expect(r.ingredients).toEqual([
      { foodId: 'product:7610000000011', grams: 80 },
      { foodId: 'skyr', grams: 200 },
      { foodId: 'banana', grams: 120 },
    ]);
    expect(allRecipes()).toContain(r);
    expect(allRecipes().slice(0, RECIPES.length)).toEqual(RECIPES);
    // One calculation: the planner's recipe macros equal the dish's portion values.
    const portion = dishPortionNutrition(dish(), 1).macros;
    expect(recipeMacros(r).kcal).toBeCloseTo(portion.kcal, 0);
    expect(recipeMacros(r).protein).toBeCloseTo(portion.protein, 0);
    // Own dishes list every ingredient – salt is summed (unlike catalog recipes with unknown cooking salt).
    expect(recipeMicros(r)).toHaveProperty('salt');
  });

  it('not a candidate: no slots, archived, or an ingredient without complete macros (still resolvable for history)', () => {
    const partial: Product = { ...oats, barcode: '2', per100: { kcal: 300 } };
    syncPersonal(base({ products: { [oats.barcode]: oats, '2': partial }, customDishes: { a: dish({ id: 'a', slots: undefined }), b: dish({ id: 'b', archived: true }), c: dish({ id: 'c', ingredients: [ingredientFromProduct(partial, 50, 'x')!] }) } }));
    expect(allRecipes().filter((r) => r.personal)).toEqual([]);
    expect(getRecipe('dish:b')).toBeDefined();
    expect(isPlannable(dish({ slots: [] }))).toBe(false);
  });

  it('diet filters: catalog foods of an own dish are checked like any recipe, own products are the user\'s choice', () => {
    const vegan = { diet: 'vegan' as const, excluded: [], slots: ['breakfast' as const] };
    syncPersonal(base());
    expect(recipeAllowed(dishAsRecipe(dish()), vegan)).toBe(false); // skyr is dairy
    expect(recipeAllowed(dishAsRecipe(dish({ ingredients: [ingredientFromProduct(oats, 100, 'a')!, ingredientFromFood(getFood('banana')!, 120, 'c')] })), vegan)).toBe(true);
  });
});

describe('prices in CHF: real product prices, per portion, no invented values', () => {
  it('an own dish with product ingredients is priced from the CHF pack prices (no catalog link needed)', () => {
    const priced = dish({ ingredients: [ingredientFromProduct(oats, 160, 'a')!] });
    // 160 g of 500 g for 1.19 CHF = 0.38 CHF, exact → a narrow range.
    expect(dishCostRange(priced, 1, priceLookup(base().products))).toEqual({ lowChf: 0, highChf: 0.5 });
    expect(formatChf(1.19)).toBe('1.19 CHF');
    // Without a price there is no cost – not a guess.
    const noPrice = { ...oats, price: undefined };
    expect(dishCostRange(dish({ ingredients: [ingredientFromProduct(noPrice, 160, 'a')!] }), 1, priceLookup({ [oats.barcode]: noPrice }))).toBeUndefined();
  });

  it('the planned own dish counts in the week budget – once, with the same price logic', () => {
    const s = base({ plannedMeals: [{ id: 'm', date: MON, slot: 'breakfast', recipeId: 'dish:porridge', servings: 1, status: 'planned', source: 'user' }] });
    syncPersonal(s);
    const recipeCost = recipeCostRange(getRecipe('dish:porridge')!, 1, priceLookup(s.products))!;
    expect(weekFoodCost(s, MON)).toEqual(recipeCost);
  });
});

describe('planner: own dishes are candidates of the existing planner', () => {
  it('a well-liked own breakfast is planned by the same planner (and respects the time budget)', () => {
    const liked = base({ learning: { preferences: { 'recipe:dish:porridge': { pos: 30, neg: 0, updatedAt: MON } } } });
    const meals = planMeals(liked, { dates: weekDays(MON), today: MON, seed: MON });
    expect(meals.some((m) => m.recipeId === 'dish:porridge' && m.slot === 'breakfast')).toBe(true);
    expect(meals.filter((m) => m.recipeId === 'dish:porridge').every((m) => m.slot === 'breakfast')).toBe(true);
    // Too long for "Wenig Zeit" (maxPrep 15) → not planned on such a day.
    const slow = { ...liked, customDishes: { porridge: dish({ prepMin: 60 }) }, dayContexts: Object.fromEntries(weekDays(MON).map((d) => [d, { timeBudget: 'low' as const, mode: 'normal' as const }])) };
    expect(planMeals(slow, { dates: weekDays(MON), today: MON, seed: MON }).some((m) => m.recipeId === 'dish:porridge')).toBe(false);
  });

  it('shopping: an own dish\'s product lands on the list under its own name; buying a pack fills the pantry', () => {
    const s = base({ plannedMeals: [{ id: 'm', date: MON, slot: 'breakfast', recipeId: 'dish:porridge', servings: 1, status: 'planned', source: 'user' }] });
    const item = weekShopping(s, MON, MON).find((i) => i.foodId === 'product:7610000000011')!;
    expect(item).toMatchObject({ name: 'Haferflocken (M-Classic)', state: 'open' });
    const r = applyWeekChange(s, { type: 'purchase', week: MON, foodId: 'product:7610000000011', grams: 500 }, new Date(2026, 8, 21, 9, 0));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.pantry['product:7610000000011']!.quantityG).toBe(500);
    expect(weekShopping(r.state, MON, MON).find((i) => i.foodId === 'product:7610000000011')!.state).not.toBe('open');
  });

  it('"Warum dieses Gericht?" names an own dish and its cost only when it can be computed', () => {
    const s = base();
    syncPersonal(s);
    const meal: PlannedMeal = { id: 'm', date: MON, slot: 'breakfast', recipeId: 'dish:porridge', servings: 1, status: 'planned', source: 'suggest' };
    const reasons = explainMeal(s, meal, MON);
    expect(reasons[0]).toBe('Dein eigenes Gericht');
    expect(reasons.some((r) => /CHF für diese Mahlzeit$/.test(r))).toBe(true);
  });
});

describe('"Als Gericht speichern" from what was really eaten', () => {
  it('recipe, catalog food and product entries become ingredients; entries without an amount are named, not guessed', () => {
    const s = base();
    const entries: LogEntry[] = [
      { id: 'r', date: MON, slot: 'breakfast', loggedAt: MON, name: 'Skyr-Bowl', recipeId: 'skyr-bowl', servings: 1, plannedMealId: 'x', method: 'plan', macros: { kcal: 500, protein: 40, carbs: 50, fat: 12 } },
      { id: 'f', date: MON, slot: 'breakfast', loggedAt: MON, name: 'Bananen', foodId: 'banana', grams: 120, method: 'food', macros: { kcal: 112, protein: 1.4, carbs: 24, fat: 0.2 } },
      { id: 'p', date: MON, slot: 'breakfast', loggedAt: MON, name: 'Haferflocken', barcode: oats.barcode, grams: 60, method: 'barcode', macros: { kcal: 222, protein: 7.8, carbs: 35.4, fat: 4.2 } },
      { id: 'm', date: MON, slot: 'breakfast', loggedAt: MON, name: 'Kaffee mit Milch', amount: 1, unit: 'portion', method: 'manual', macros: { kcal: 40, protein: 2, carbs: 3, fat: 2 } },
    ];
    let n = 0;
    const { draft, skipped } = draftFromEntries(entries, s, () => `i${n++}`);
    expect(draft.ingredients.map((i) => [i.name, i.grams, i.source])).toEqual([
      ...getRecipe('skyr-bowl')!.ingredients.map((i) => [getFood(i.foodId)!.name, i.grams, 'catalog']),
      ['Bananen', 120, 'catalog'],
      ['Haferflocken (M-Classic)', 60, 'product'],
    ]);
    expect(skipped).toEqual(['Kaffee mit Milch']);
    // Logged as a dish again, the values match what was eaten (same sources, same scaling).
    const logged = dishEntry({ ...dish(), ...draft, id: 'new', name: 'Mein Frühstück' }, 1);
    expect(Math.abs(logged.macros.kcal - (getRecipe('skyr-bowl') ? recipeMacros(getRecipe('skyr-bowl')!).kcal + 112 + 222 : 0))).toBeLessThanOrEqual(2);
  });
});
