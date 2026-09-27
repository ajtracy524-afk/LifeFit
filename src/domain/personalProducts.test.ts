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
import { applyWeekChange, planMeals, purchaseAmount, weekFoodCost, weekShopping } from './week';

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
    expect(formatChf(1.19)).toBe('CHF 1.19');
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
    expect(reasons.some((r) => /^ca\. CHF [\d.]+–[\d.]+ für diese Mahlzeit$|^unter CHF 1\.– für diese Mahlzeit$/.test(r))).toBe(true);
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

describe('hardening: exclusions, completeness, pantry, shopping, unknown ≠ 0', () => {
  const planned = (id: string, date: string, status: PlannedMeal['status'] = 'planned'): PlannedMeal => ({ id, date, slot: 'breakfast', recipeId: 'dish:porridge', servings: 1, status, source: 'user' });

  it('Open Food Facts: declared allergens and a DEFINITE diet analysis are read; "maybe" stays unknown', async () => {
    const { normalizeOffProduct } = await import('../services/productLookup');
    const skyr = normalizeOffProduct('7610900016099', { product_name: 'Skyr', nutriments: { 'energy-kcal_100g': 60 }, allergens_tags: ['en:milk', 'en:celery'], ingredients_analysis_tags: ['en:non-vegan', 'en:maybe-vegetarian'] })!;
    expect(skyr.allergens).toEqual(['lactose']); // celery is not an exclusion LifeFit knows – not mapped, not guessed
    expect(skyr.diet).toEqual({ vegan: false });
    const plain = normalizeOffProduct('1', { product_name: 'Etwas', nutriments: { 'energy-kcal_100g': 60 } })!;
    expect(plain).not.toHaveProperty('allergens');
    expect(plain).not.toHaveProperty('diet');
  });

  it('known facts are hard exclusions for own dishes; unknown is the user\'s choice (nothing guessed from the name)', () => {
    const skyrProduct: Product = { ...oats, barcode: 's', name: 'Skyr', allergens: ['lactose'], diet: { vegan: false } };
    const withSkyr = dish({ ingredients: [ingredientFromProduct(skyrProduct, 200, 'x')!] });
    syncPersonal(base({ products: { s: skyrProduct }, customDishes: { porridge: withSkyr } }));
    const r = getRecipe('dish:porridge')!;
    expect(recipeAllowed(r, { diet: 'vegan', excluded: [], slots: ['breakfast'] })).toBe(false);
    expect(recipeAllowed(r, { diet: 'omnivore', excluded: ['lactose'], slots: ['breakfast'] })).toBe(false);
    expect(recipeAllowed(r, { diet: 'vegetarian', excluded: [], slots: ['breakfast'] })).toBe(true); // vegetarian is unknown → allowed
    // The same product without any stated facts: allowed for everyone (the user's own product).
    syncPersonal(base({ products: { s: { ...skyrProduct, allergens: undefined, diet: undefined } }, customDishes: { porridge: withSkyr } }));
    expect(recipeAllowed(getRecipe('dish:porridge')!, { diet: 'vegan', excluded: ['lactose'], slots: ['breakfast'] })).toBe(true);
  });

  it('a product whose CURRENT values lack a macro takes its dishes out of the planner (unknown is not 0)', () => {
    syncPersonal(base({ products: { [oats.barcode]: { ...oats, per100: { kcal: 370, carbs: 59, fat: 7 } } } }));
    expect(allRecipes().some((r) => r.id === 'dish:porridge')).toBe(false);
    syncPersonal(base());
    expect(allRecipes().some((r) => r.id === 'dish:porridge')).toBe(true);
  });

  it('own recipe → shopping: pantry 20 g, need 80 g → 60 g open, bought as one real pack; one position even if two dishes use it', () => {
    const second = dish({ id: 'second', name: 'Overnight Oats', slots: ['snack'] });
    const s = base({
      customDishes: { porridge: dish(), second },
      pantry: { 'product:7610000000011': { foodId: 'product:7610000000011', quantityG: 20, updatedAt: `${MON}T07:00:00Z` } },
      plannedMeals: [planned('m', MON), { ...planned('n', MON), slot: 'snack', recipeId: 'dish:second' }],
    });
    const items = weekShopping(s, MON, MON).filter((i) => i.foodId === 'product:7610000000011');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ neededG: 160, remainingG: 140, state: 'open', quantity: '140 g' });
    // Bought as whole packs: one 500 g pack, priced with the user's pack price (CHF 1.19).
    expect(purchaseAmount(getFood('product:7610000000011')!, items[0]!.remainingG)).toBe(500);
    expect(items[0]!.estCostChf).toBeCloseTo(1.19, 2);
    const one = weekShopping({ ...s, customDishes: { porridge: dish() }, plannedMeals: [planned('m', MON)] }, MON, MON).find((i) => i.foodId === 'product:7610000000011')!;
    expect(one).toMatchObject({ neededG: 80, remainingG: 60 });
  });

  it('own recipe planned and eaten → the pantry is used once (no double booking, no new stock)', async () => {
    const { logFromMeal } = await import('./nutrition');
    const { pantryEstimate } = await import('./week');
    const s = base({ pantry: { 'product:7610000000011': { foodId: 'product:7610000000011', quantityG: 500, updatedAt: `${MON}T07:00:00Z` } } });
    syncPersonal(s);
    const eaten = planned('m', MON, 'eaten');
    const entry = logFromMeal(eaten, `${MON}T08:00:00Z`);
    expect(pantryEstimate({ ...s, logEntries: [entry] })['product:7610000000011']).toBe(420); // 500 − 80 g per portion
    // The shopping list does not buy it again for the eaten meal.
    expect(weekShopping({ ...s, plannedMeals: [eaten], logEntries: [entry] }, MON, MON).find((i) => i.foodId === 'product:7610000000011')).toBeUndefined();
  });

  it('a product without sugar data: the dish has no sugar value – never 0 g', () => {
    const noSugar: Product = { ...oats, micros100: { fiber: 10 } };
    const d = dish({ ingredients: [ingredientFromProduct(noSugar, 100, 'a')!, ingredientFromFood(getFood('banana')!, 120, 'b')] });
    const n = dishPortionNutrition(d, 1);
    expect(n.micros).not.toHaveProperty('sugar');
    expect(n.micros.fiber).toBeGreaterThan(0);
  });
});
