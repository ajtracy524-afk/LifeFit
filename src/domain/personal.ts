import { consistentMicros } from '../data/nutrients';
import { setPersonal } from '../data/personal';
import { dishNutrition, ingredientFoodId, productFoodId } from './dishes';
import type { AppState, CustomDish, DishIngredient, Food, Product, Recipe } from './types';

/**
 * The user's own products and dishes, made known to the existing systems –
 * no second planner, shopping list, pantry or price logic:
 *
 * - Every scanned / created product becomes a food `product:<barcode>` (its
 *   values per 100 g/ml, pack size, real price). Pantry, shopping and costs
 *   work with it like with a catalog food.
 * - Database / manual ingredients of own dishes become foods with the
 *   values stored in the dish (the dish's snapshot – nothing is re-fetched).
 * - An own dish WITH meal slots and complete macros becomes a recipe
 *   `dish:<id>` (ingredients per portion) – a candidate of the existing
 *   planner (recipesForSlot → scoreWeek), scored like every recipe.
 *
 * Runs whenever the state changes (store) and at the start of planning;
 * memoized by reference, so an unchanged state costs nothing.
 */

export { ingredientFoodId, productFoodId } from './dishes';
export const dishRecipeId = (dishId: string) => `dish:${dishId}`;

const macrosOrZero = (p: Partial<Food['per100']>): Food['per100'] => ({ kcal: p.kcal ?? 0, protein: p.protein ?? 0, carbs: p.carbs ?? 0, fat: p.fat ?? 0 });

function productFood(p: Product): Food | undefined {
  if (p.per100.kcal === undefined) return undefined;
  const micros = consistentMicros(p.per100, p.micros100);
  return {
    id: productFoodId(p.barcode),
    name: p.brand ? `${p.name} (${p.brand})` : p.name,
    category: 'pantry',
    per100: macrosOrZero(p.per100),
    // Only what is known: declared allergens and stated diet; the rest is marked unknown (see recipeAllowed).
    vegan: p.diet?.vegan === true,
    vegetarian: p.diet?.vegetarian === true,
    allergens: p.allergens ?? [],
    ...(p.diet?.vegan === undefined || p.diet?.vegetarian === undefined
      ? { dietUnknown: { ...(p.diet?.vegan === undefined ? { vegan: true as const } : {}), ...(p.diet?.vegetarian === undefined ? { vegetarian: true as const } : {}) } }
      : {}),
    ...(p.packageSize ? { packageG: p.packageSize } : {}),
    // A real price the user entered (CHF per pack) – priced exactly via priceLookup, here for package rounding.
    ...(p.price && p.price.amount > 0 ? { estPricePerKg: (p.price.chf / p.price.amount) * 1000 } : {}),
    ...(micros && Object.keys(micros).length ? { micros } : {}),
  };
}

function ingredientFood(i: DishIngredient): Food {
  return {
    id: ingredientFoodId(i),
    name: i.name,
    category: 'pantry',
    per100: macrosOrZero(i.per100),
    vegan: false,
    vegetarian: false,
    allergens: [],
    dietUnknown: { vegan: true, vegetarian: true },
    ...(i.micros100 && Object.keys(i.micros100).length ? { micros: i.micros100 } : {}),
  };
}

/** A dish the planner may suggest: meal slots chosen, not archived, every macro of every ingredient known. */
export function isPlannable(dish: CustomDish): boolean {
  return !!dish.slots?.length && !dish.archived && dish.ingredients.length > 0 && dishNutrition(dish.ingredients).unknown.length === 0;
}

export function dishAsRecipe(dish: CustomDish): Recipe {
  const portions = dish.portions > 0 ? dish.portions : 1;
  return {
    id: dishRecipeId(dish.id),
    title: dish.name,
    emoji: '🍽️',
    slots: dish.slots?.length ? dish.slots : ['lunch'],
    prepMin: dish.prepMin ?? 15,
    tags: ['Mein Gericht'],
    ingredients: dish.ingredients.map((i) => ({ foodId: ingredientFoodId(i), grams: Math.round((i.grams / portions) * 10) / 10 })),
    steps: [],
    personal: true,
  };
}

let last: { dishes: unknown; products: unknown } | undefined;

export function syncPersonal(state: Pick<AppState, 'customDishes' | 'products'>): void {
  if (last && last.dishes === state.customDishes && last.products === state.products) return;
  last = { dishes: state.customDishes, products: state.products };
  const foods = new Map<string, Food>();
  // Products whose CURRENT values lack a macro: a dish using them is not planned (unknown is not 0).
  const incomplete = new Set<string>();
  for (const p of Object.values(state.products ?? {})) {
    const f = productFood(p);
    if (f) foods.set(f.id, f);
    if (p.per100.kcal === undefined || p.per100.protein === undefined || p.per100.carbs === undefined || p.per100.fat === undefined) incomplete.add(productFoodId(p.barcode));
  }
  const recipes = new Map<string, Recipe>();
  const candidates: Recipe[] = [];
  for (const dish of Object.values(state.customDishes ?? {})) {
    for (const i of dish.ingredients) {
      const id = ingredientFoodId(i);
      // Catalog foods are known anyway; a product already registered keeps its current values.
      if (!i.foodId && !foods.has(id)) foods.set(id, ingredientFood(i));
    }
    const recipe = dishAsRecipe(dish);
    recipes.set(recipe.id, recipe);
    if (isPlannable(dish) && !recipe.ingredients.some((i) => incomplete.has(i.foodId))) candidates.push(recipe);
  }
  setPersonal(foods, recipes, candidates);
}
