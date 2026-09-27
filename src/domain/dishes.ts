import type { DbFood } from '../data/foodDb';
import { SALT_PER_SODIUM } from '../data/nutrients';
import { ingredientCostRange, type CostRange, type PriceLookup } from './costs';
import type { EntryContent } from './foodEntry';
import { consistentMicros, roundMacros, scaleMacros, scaleMicros, sumCompleteMicros } from './nutrition';
import { getFood } from '../data/foods';
import { getRecipe } from '../data/recipes';
import type { AppState, CustomDish, DishIngredient, Food, LogEntry, MacroKey, Macros, MealSlot, Micros, Product } from './types';

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

export const productFoodId = (barcode: string) => `product:${barcode}`;

/**
 * The food id an ingredient is planned, bought, priced and kept in the pantry
 * under: the catalog food if linked, otherwise the own product / database /
 * manual ingredient (registered as a personal food, see domain/personal.ts).
 */
export function ingredientFoodId(i: DishIngredient): string {
  if (i.foodId) return i.foodId;
  if (i.source === 'product') return productFoodId(i.ref);
  if (i.source === 'database') return i.ref; // "fdc:<id>"
  return `manual:${i.id}`;
}

/** Price items for the central cost logic: every ingredient under its food id (real product prices, catalog estimates, or unpriced). */
export function dishCostItems(dish: CustomDish, portions = 1): { foodId: string; grams: number }[] {
  const f = portionFactor(dish, portions);
  return dish.ingredients.map((i) => ({ foodId: ingredientFoodId(i), grams: Math.round(i.grams * f) }));
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
  return { id, name: food.name, grams, source: 'database', ref: food.id, per100: { ...food.per100 }, micros100: dbFoodMicros(food) };
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
  /** Offer it in the week plan for these meals (optional). */
  slots?: MealSlot[];
  prepMin?: number;
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
  const micros = scaleMicros(dbFoodMicros(food), f);
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
  return consistentMicros(food.per100, withSalt(food.micros)) ?? {};
}

// ---------- "Als Gericht speichern" (from what was really eaten) ----------

/** Per-100 values from an entry's own snapshot (exact inverse of the scaling) – only known values. */
function snapshotPer100(e: LogEntry): { per100: Partial<Macros>; micros100: Micros } {
  const f = 100 / (e.grams ?? 1);
  const unknown = new Set(e.unknown ?? []);
  const per100: Partial<Macros> = { kcal: Math.round(e.macros.kcal * f * 10) / 10 };
  for (const k of ['protein', 'carbs', 'fat'] as const) if (!unknown.has(k)) per100[k] = Math.round(e.macros[k] * f * 100) / 100;
  const micros100: Micros = {};
  for (const [k, v] of Object.entries(e.micros ?? {})) micros100[k as keyof Micros] = (v as number) * f;
  return { per100, micros100 };
}

/**
 * Turns the entries of an eaten meal into a dish draft – only with data the
 * app really has: recipe and dish ingredients, catalog foods and products
 * with their amount, database/manual entries with grams (from their own
 * snapshot). Entries without an amount cannot become ingredients and are
 * named in `skipped` – never guessed.
 */
export function draftFromEntries(entries: LogEntry[], state: Pick<AppState, 'products' | 'customDishes'>, newIdFn: () => string): { draft: DishDraft; skipped: string[] } {
  const ingredients: DishIngredient[] = [];
  const skipped: string[] = [];
  for (const e of entries) {
    const dish = e.dishId ? state.customDishes?.[e.dishId] : undefined;
    const recipe = !dish && e.recipeId ? getRecipe(e.recipeId) : undefined;
    const product = e.barcode ? state.products?.[e.barcode] : undefined;
    if (dish) {
      const f = portionFactor(dish, e.servings ?? 1);
      for (const i of dish.ingredients) ingredients.push({ ...i, id: newIdFn(), grams: Math.round(i.grams * f) });
    } else if (recipe) {
      for (const i of recipe.ingredients) {
        const food = getFood(i.foodId);
        if (food) ingredients.push(ingredientFromFood(food, Math.round(i.grams * (e.servings ?? 1)), newIdFn()));
      }
    } else if (e.foodId && e.method === 'food' && e.grams && getFood(e.foodId)) {
      ingredients.push(ingredientFromFood(getFood(e.foodId)!, e.grams, newIdFn()));
    } else if (product && e.grams) {
      const ing = ingredientFromProduct(product, e.grams, newIdFn());
      if (ing) ingredients.push(ing);
      else skipped.push(e.name);
    } else if (e.grams && (e.fdc !== undefined || e.unit === 'g' || e.unit === 'ml')) {
      const { per100, micros100 } = snapshotPer100(e);
      ingredients.push({ id: newIdFn(), name: e.name, grams: e.grams, source: e.fdc !== undefined ? 'database' : 'manual', ref: e.fdc !== undefined ? `fdc:${e.fdc}` : e.id, per100, micros100 });
    } else skipped.push(e.name);
  }
  return { draft: { name: '', portions: 1, ingredients }, skipped };
}
