import { describe, expect, it } from 'vitest';
import { getFood } from '../data/foods';
import { getRecipe } from '../data/recipes';
import { emptyState } from '../store/persistence';
import { weekDays } from './dates';
import { logFromMeal } from './nutrition';
import { seededRandom, suggestWeek } from './planner';
import type { AppState, NutritionProfile, PlannedMeal, Product } from './types';
import { applyWeekChange, pantryEstimate, weekShopping } from './week';
import { checklistFor, levelGrams, productViolates, suggestFoodForProduct } from './week/pantryOnboarding';

/** Prompt 6 – "Was hast du schon zu Hause?": checklist, fill levels, MHD, mapping, exclusions. */

const WEEK = '2026-10-05';
const NOW = new Date(2026, 9, 5, 8);
const omni: NutritionProfile = { diet: 'omnivore', excluded: [], slots: ['breakfast', 'snack', 'lunch', 'dinner'] };
const state = (patch: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  nutritionProfile: omni,
  targets: [{ id: 't', validFrom: '2026-01-01', method: 'formula', kcal: 2600, protein: 150, carbs: 300, fat: 80 }],
  ...patch,
});
const meal = (date: string, slot: PlannedMeal['slot'], recipeId: string, id = `${date}-${slot}`): PlannedMeal => ({ id, date, slot, recipeId, servings: 1, status: 'planned', source: 'suggest' });
const ok = (r: ReturnType<typeof applyWeekChange>) => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
const product = (patch: Partial<Product> = {}): Product => ({ barcode: '7610000000001', name: 'Penne Rigate', brand: 'Coop', per100: { kcal: 350 }, micros100: {}, unit: 'g', packageSize: 500, source: 'openfoodfacts', fetchedAt: NOW.toISOString(), ...patch });

describe('basics checklist', () => {
  it('is grouped, filtered by the hard exclusions, and marks the staples', () => {
    const all = checklistFor(omni);
    expect(all.map((g) => g.label)).toEqual(['Öle & Fette', 'Gewürze & Würze', 'Getreide & Nudeln', 'Konserven', 'Milchprodukte & Eier', 'Tiefkühl']);
    const spices = all.find((g) => g.id === 'spices')!.items;
    expect(spices.filter((i) => i.staple).map((i) => i.foodId)).toEqual(['salt', 'pepper', 'curry-powder', 'vinegar']);
    expect(all.find((g) => g.id === 'fats')!.items.find((i) => i.foodId === 'olive-oil')!.staple).toBe(true); // oil like salt and pepper

    const vegan = checklistFor({ ...omni, diet: 'vegan' }).flatMap((g) => g.items.map((i) => i.foodId));
    for (const id of ['milk', 'egg', 'tuna', 'honey', 'quark']) expect(vegan).not.toContain(id);
    // Lactose intolerance: milk is offered as the lactose-free variant, stored as the recipe ingredient (E20).
    const lactose = checklistFor({ ...omni, intolerances: ['lactose'] }).find((g) => g.id === 'dairy')!.items.find((i) => i.foodId === 'milk')!;
    expect(lactose.name).toBe('Milch 1,5 % laktosefrei');
    const nuts = checklistFor({ ...omni, allergens: ['peanuts'] }).flatMap((g) => g.items.map((i) => i.foodId));
    expect(nuts).not.toContain('peanut-butter');
  });

  it('a fill level is a share of the package', () => {
    expect(levelGrams(getFood('pasta')!, 'full')).toBe(500);
    expect(levelGrams(getFood('pasta')!, 'half')).toBe(250);
    expect(levelGrams(getFood('pasta')!, 'rest')).toBe(75);
  });
});

describe('the shopping list subtracts what is at home', () => {
  it('checked basics with their fill level reduce the amount to buy', () => {
    // Couscous is no restock basic (F8) – the list shows exactly the plan's need minus the stock.
    const plan = [meal('2026-10-06', 'lunch', 'couscous-salad'), meal('2026-10-07', 'lunch', 'couscous-salad')]; // 2 × 80 g
    const without = weekShopping(state({ plannedMeals: plan }), WEEK, WEEK).find((i) => i.foodId === 'couscous')!;
    expect(without.remainingG).toBe(160);
    const rest = ok(applyWeekChange(state({ plannedMeals: plan }), { type: 'setPantry', foodId: 'couscous', quantityG: levelGrams(getFood('couscous')!, 'rest'), level: 'rest' }, NOW));
    expect(rest.pantry.couscous).toMatchObject({ quantityG: 75, level: 'rest' });
    expect(weekShopping(rest, WEEK, WEEK).find((i) => i.foodId === 'couscous')!.remainingG).toBe(85);
    const half = ok(applyWeekChange(rest, { type: 'setPantry', foodId: 'couscous', quantityG: 250, level: 'half' }, NOW));
    expect(weekShopping(half, WEEK, WEEK).find((i) => i.foodId === 'couscous')!.state).toBe('have');
  });

  it('staples (salt, pepper, oil) appear only when marked empty', () => {
    const plan = [meal('2026-10-06', 'dinner', 'bolognese')];
    expect(weekShopping(state({ plannedMeals: plan }), WEEK, WEEK).some((i) => i.foodId === 'olive-oil')).toBe(false);
    const empty = ok(applyWeekChange(state({ plannedMeals: plan }), { type: 'setPantry', foodId: 'olive-oil', quantityG: 0 }, NOW));
    expect(weekShopping(empty, WEEK, WEEK).find((i) => i.foodId === 'olive-oil')).toMatchObject({ state: 'open', remainingG: 500 });
  });

  it('a scan adds its package with the earliest best-before date; eaten food still subtracts, nothing fills the pantry', () => {
    let s = ok(applyWeekChange(state(), { type: 'addPantry', foodId: 'quark', grams: 500, bestBefore: '2026-10-12' }, NOW));
    s = ok(applyWeekChange(s, { type: 'addPantry', foodId: 'quark', grams: 500, bestBefore: '2026-10-09' }, NOW));
    expect(s.pantry.quark).toMatchObject({ quantityG: 1000, bestBefore: '2026-10-09' });
    // Eaten with a catalog food → subtracted (as before) …
    const eaten = { ...meal('2026-10-05', 'snack', 'quark-berries'), status: 'eaten' as const };
    const later = { ...s, plannedMeals: [eaten], logEntries: [logFromMeal(eaten, '2026-10-05T15:00:00.000Z')] };
    expect(pantryEstimate(later).quark).toBe(750);
    // … but eating never puts anything INTO the pantry.
    expect(pantryEstimate(later).berries).toBeUndefined();
  });
});

describe('the planner uses stock first – above all when it expires soon', () => {
  const dates = weekDays(WEEK);
  const target = { kcal: 2600, protein: 150, carbs: 300, fat: 80 };
  const uses = (foodId: string, extra: Partial<Parameters<typeof suggestWeek>[0]>) =>
    ['1', '2', '3', '4', '5', '6'].reduce(
      (n, seed) =>
        n +
        suggestWeek({ dates, slots: omni.slots, target, profile: omni, existing: [], random: seededRandom(seed), ...extra }).filter((m) =>
          getRecipe(m.recipeId)!.ingredients.some((i) => i.foodId === foodId),
        ).length,
      0,
    );

  it('canned chickpeas about to expire are planned more often than without a date – stock is used first', () => {
    const none = uses('chickpeas', {});
    const pantry = { chickpeas: 265 };
    const plain = uses('chickpeas', { pantry });
    const expiring = uses('chickpeas', { pantry, pantryExpiryDays: { chickpeas: 1 } });
    expect(plain).toBeGreaterThanOrEqual(none); // stock is free – never used less
    expect(expiring).toBeGreaterThan(plain);
    expect(uses('chickpeas', { pantry, pantryExpiryDays: { chickpeas: 30 } })).toBe(plain); // far away: no effect
  });
});

describe('scanned products', () => {
  it('suggests the catalog food: remembered mapping first, then category, then name', () => {
    expect(suggestFoodForProduct(product({ foodId: 'couscous' }))).toMatchObject({ foodId: 'couscous', reason: 'remembered' });
    expect(suggestFoodForProduct(product({ name: 'Bio Tagliatelle', categories: ['en:pastas'] }))).toMatchObject({ foodId: 'pasta', reason: 'category' });
    expect(suggestFoodForProduct(product({ name: 'Basmatireis Premium' }))).toMatchObject({ foodId: 'rice', reason: 'name' });
    // A lactose-free product maps to the recipe ingredient (the pantry keeps one identity).
    expect(suggestFoodForProduct(product({ name: 'Milch laktosefrei', categories: ['en:milks'] })).foodId).toBe('milk');
    expect(suggestFoodForProduct(product({ name: 'Xyz', categories: [] }))).toEqual({ candidates: [] });
  });

  it('a product that breaks a hard exclusion is marked', () => {
    const nutBar = product({ name: 'Nussriegel', lmivAllergens: ['tree_nuts'], foodId: 'protein-bar' });
    expect(productViolates(nutBar, { ...omni, allergens: ['tree_nuts'] })).toBe(true);
    expect(productViolates(nutBar, omni)).toBe(false);
    expect(productViolates(product({ lmivTraces: ['sesame'] }), { ...omni, allergens: ['sesame'] })).toBe(true);
    expect(productViolates(product({ lmivTraces: ['sesame'] }), { ...omni, allergens: ['sesame'], tracesOk: ['sesame'] })).toBe(false);
    expect(productViolates(product({ diet: { vegetarian: false, vegan: false } }), { ...omni, diet: 'vegetarian' })).toBe(true);
  });
});
