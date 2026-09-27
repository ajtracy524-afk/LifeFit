import type { DbFood } from '../data/foodDb';
import { SALT_PER_SODIUM } from '../data/nutrients';
import { ingredientCostRange, type CostRange, type PriceLookup } from './costs';
import type { EntryContent } from './foodEntry';
import { roundMacros, scaleMacros, scaleMicros, sumCompleteMicros } from './nutrition';
import type { CustomDish, DishIngredient, Food, MacroKey, Macros, Micros, Product } from './types';

/**
 * Own dishes ("Meine Gerichte"): nutrients are ALWAYS computed from the
 * ingredients – nothing is typed in or estimated.
 *
 * - kcal: every ingredient has it (only sources with kcal can be added).
 * - Protein / carbs / fat: summed; if an ingredient lacks one, that macro is
 *   marked unknown (like a product without it).
 * - Fiber, sugar, salt, vitamins, minerals: the ingredient rule
 *   (sumCompleteMicros) – known only if every ingredient has it. Unlike
 *   catalog recipes, salt IS summed: an own dish lists what goes in.
 * - Portions: values of the whole dish × eaten portions / portions it makes.
 */

const MACRO_KEYS: MacroKey[] = ['protein', 'carbs', 'fat'];

export interface DishNutrition {
  macros: Macros;
  micros: Micros;
  unknown: MacroKey[];
}

/** Nutrients of the ingredients scaled by `factor` (1 = the whole dish). */
export function dishNutrition(ingredients: DishIngredient[], factor = 1): DishNutrition {
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const unknown = new Set<MacroKey>();
  for (const ing of ingredients) {
    const f = (ing.grams * factor) / 100;
    sum.kcal += (ing.per100.kcal ?? 0) * f;
    for (const k of MACRO_KEYS) {
      const v = ing.per100[k];
      if (v === undefined) unknown.add(k);
      else sum[k] += v * f;
    }
  }
  const micros = sumCompleteMicros(ingredients.map((i) => ({ micros100: i.micros100, grams: i.grams * factor })));
  return { macros: roundMacros(sum), micros, unknown: MACRO_KEYS.filter((k) => unknown.has(k)) };
}

/** Factor for eating `portions` of a dish that makes `dish.portions`. */
export function portionFactor(dish: Pick<CustomDish, 'portions'>, portions: number): number {
  return dish.portions > 0 ? portions / dish.portions : 0;
}

export function dishPortionNutrition(dish: CustomDish, portions = 1): DishNutrition {
  return dishNutrition(dish.ingredients, portionFactor(dish, portions));
}

/** Price items for the central cost logic: catalog-linked ingredients priced, the rest counts as unpriced weight. */
export function dishCostItems(dish: CustomDish, portions = 1): { foodId: string; grams: number }[] {
  const f = portionFactor(dish, portions);
  return dish.ingredients.map((i) => ({ foodId: i.foodId ?? '', grams: Math.round(i.grams * f) }));
}

/** "ca. 2–3 CHF" range – only with enough price data (80 % rule), otherwise undefined. */
export function dishCostRange(dish: CustomDish, portions: number, price: PriceLookup): CostRange | undefined {
  return ingredientCostRange(dishCostItems(dish, portions), price);
}

/** Log entry content: a snapshot of the dish as it is now – later edits never change it. */
export function dishEntry(dish: CustomDish, portions: number): EntryContent {
  const n = dishPortionNutrition(dish, portions);
  const grams = Math.round(dish.ingredients.reduce((s, i) => s + i.grams, 0) * portionFactor(dish, portions));
  return {
    name: dish.name,
    method: 'dish',
    dishId: dish.id,
    servings: portions,
    amount: portions,
    unit: 'portion',
    grams,
    macros: n.macros,
    ...(Object.keys(n.micros).length ? { micros: n.micros } : {}),
    ...(n.unknown.length ? { unknown: n.unknown } : {}),
    ingredients: dishCostItems(dish, portions),
  };
}

// ---------- Ingredients from the three sources ----------

/** Salt from sodium where a source lists only sodium (salt = sodium × 2.5 by definition). */
function withSalt(micros: Micros): Micros {
  // Unrounded here – rounding happens once, after scaling to the eaten amount (scaleMicros).
  return micros.salt === undefined && micros.sodium !== undefined ? { ...micros, salt: (micros.sodium * SALT_PER_SODIUM) / 1000 } : micros;
}

export function ingredientFromFood(food: Food, grams: number, id: string): DishIngredient {
  return { id, name: food.name, grams, source: 'catalog', ref: food.id, per100: { ...food.per100 }, ...(food.micros ? { micros100: { ...food.micros } } : {}), foodId: food.id };
}

export function ingredientFromDb(food: DbFood, grams: number, id: string): DishIngredient {
  return { id, name: food.name, grams, source: 'database', ref: food.id, per100: { ...food.per100 }, micros100: withSalt(food.micros) };
}

/** Undefined for a product without calories – it cannot be part of a computed dish. */
export function ingredientFromProduct(product: Product, grams: number, id: string): DishIngredient | undefined {
  if (product.per100.kcal === undefined) return undefined;
  return {
    id,
    name: product.brand ? `${product.name} (${product.brand})` : product.name,
    grams,
    source: 'product',
    ref: product.barcode,
    per100: { ...product.per100 },
    micros100: { ...product.micros100 },
    ...(product.foodId ? { foodId: product.foodId } : {}),
  };
}

export interface DishDraft {
  name: string;
  portions: number;
  ingredients: DishIngredient[];
}

export type DishErrors = Partial<Record<'name' | 'ingredients' | 'portions', string>>;

/** Validation before saving – a dish needs a name, at least one ingredient with an amount, and portions. */
export function validateDish(draft: DishDraft): DishErrors {
  const errors: DishErrors = {};
  if (!draft.name.trim()) errors.name = 'Gib dem Gericht einen Namen.';
  if (!draft.ingredients.length) errors.ingredients = 'Füge mindestens eine Zutat hinzu.';
  else if (draft.ingredients.some((i) => !(i.grams > 0))) errors.ingredients = 'Jede Zutat braucht eine Menge über 0 g.';
  if (!(draft.portions > 0)) errors.portions = 'Mindestens eine halbe Portion.';
  return errors;
}

/** Log entry content of a database food (FoodData Central) – no catalog link, so no pantry and no price. */
export function dbFoodEntry(food: DbFood, grams: number): EntryContent {
  const f = grams / 100;
  const micros = scaleMicros(withSalt(food.micros), f);
  return {
    name: food.name,
    method: 'food',
    grams,
    fdc: food.fdc,
    macros: roundMacros(scaleMacros(food.per100, f)),
    ...(Object.keys(micros).length ? { micros } : {}),
  };
}

/** Per-100 g micros of a database food as used everywhere (salt from sodium). */
export function dbFoodMicros(food: DbFood): Micros {
  return withSalt(food.micros);
}
