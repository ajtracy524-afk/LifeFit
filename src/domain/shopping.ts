import { CATEGORIES, getFood } from '../data/foods';
import { getRecipe } from '../data/recipes';
import { formatGrams } from '../lib/format';
import { addDays } from './dates';
import type { Food, ISODate, MealSlot, PlannedMeal, ShoppingCategory } from './types';

export interface ShoppingSource {
  mealId: string;
  date: ISODate;
  slot: MealSlot;
  recipeTitle: string;
  grams: number;
}

export interface ShoppingItem {
  foodId: string;
  name: string;
  category: ShoppingCategory;
  grams: number;
  quantity: string;
  hint?: string;
  sources: ShoppingSource[];
  /**
   * E20: what is actually bought (the lactose-free variant). Name, category and
   * quantity describe it; `foodId` stays the recipe ingredient, so pantry and
   * plan keep one identity.
   */
  buyFoodId?: string;
}

/**
 * The shopping list is DERIVED from the meal plan: every planned (not yet eaten)
 * meal contributes its scaled ingredients. Adding, swapping or removing a meal
 * therefore updates the list automatically – no sync code needed.
 */
export function buildShoppingList(
  meals: PlannedMeal[],
  from: ISODate,
  to: ISODate,
  buyAs: (foodId: string) => string = (id) => id,
  /** People who eat along (Prompt 4): scales the amounts – the plan and its nutrients stay the user's. */
  people = 1,
): ShoppingItem[] {
  const byFood = new Map<string, ShoppingItem>();

  for (const meal of meals) {
    if (meal.status !== 'planned' || meal.date < from || meal.date > to) continue;
    const recipe = getRecipe(meal.recipeId);
    if (!recipe) continue;

    for (const ing of recipe.ingredients) {
      const food = getFood(ing.foodId);
      if (!food) continue;
      const grams = ing.grams * meal.servings * people;
      let item = byFood.get(food.id);
      if (!item) {
        const buyId = buyAs(food.id);
        const bought = buyId !== food.id ? getFood(buyId) : undefined;
        item = bought
          ? { foodId: food.id, buyFoodId: bought.id, name: bought.name, category: bought.category, grams: 0, quantity: '', sources: [] }
          : { foodId: food.id, name: food.name, category: food.category, grams: 0, quantity: '', sources: [] };
        byFood.set(food.id, item);
      }
      item.grams += grams;
      item.sources.push({ mealId: meal.id, date: meal.date, slot: meal.slot, recipeTitle: recipe.title, grams });
    }
  }

  const items = [...byFood.values()];
  for (const item of items) {
    const food = getFood(item.buyFoodId ?? item.foodId)!;
    const q = describeQuantity(food, item.grams);
    item.quantity = q.quantity;
    item.hint = q.hint;
    item.sources.sort((a, b) => a.date.localeCompare(b.date));
  }
  return items;
}

/** Date range a week's list covers: rest of the current week, or all of a later week. */
export function shoppingRange(week: ISODate, today: ISODate): { from: ISODate; to: ISODate } {
  return { from: week > today ? week : today, to: addDays(week, 6) };
}

export type ShoppingItemState = 'open' | 'checked' | 'have';

export interface ShoppingListItem extends ShoppingItem {
  state: ShoppingItemState;
  /** Grams the planned meals need in the range. */
  neededG: number;
  /** Grams still to buy after pantry and purchases. `quantity` describes this amount for open items. */
  remainingG: number;
  /** F8: minimum stock of this basic (set if the basic is restocked this week). */
  restockMinG?: number;
  /** F8: part of `remainingG` that only refills the stock (not needed by the plan). */
  restockG?: number;
  /** Estimated price of what is still to buy (whole packages); undefined = no price known. */
  estCostChf?: number;
}

/**
 * Applies what is available (pantry estimate, already reserved for earlier
 * meals) to the gross need:
 *   remaining = 0 and bought this week → "checked"
 *   remaining = 0 without purchase     → "have"
 *   remaining > 0                      → "open" with the missing amount
 * Buying chicken and then planning another chicken meal therefore reopens
 * the item with exactly the extra amount.
 */
export function applyStock(items: ShoppingItem[], available: Record<string, number>, purchased: Record<string, number>): ShoppingListItem[] {
  return items.map((item) => {
    const food = getFood(item.foodId)!;
    const remainingG = Math.max(0, item.grams - (available[item.foodId] ?? 0));
    // Same tolerance as describeQuantity: "3 Stück" covers up to 3.15 pieces.
    if (remainingG < Math.max(1, (food.pieceG ?? 0) * PIECE_TOLERANCE)) {
      return { ...item, neededG: item.grams, remainingG: 0, state: purchased[item.foodId] ? 'checked' : 'have' };
    }
    const q = remainingG < item.grams ? describeQuantity(food, remainingG) : { quantity: item.quantity, hint: item.hint };
    return { ...item, neededG: item.grams, remainingG, quantity: q.quantity, hint: q.hint, state: 'open' };
  });
}

/** Fraction of a piece that is not worth an extra one ("3,1 Bananen" → 3 Stück). */
export const PIECE_TOLERANCE = 0.15;

/** "3 Stück", "900 g" and a package hint like "2 × 450 g". */
export function describeQuantity(food: Food, grams: number): { quantity: string; hint?: string } {
  // A few grams of salt, pepper or spice are a pinch, not a weight.
  if (food.tags?.staple && grams > 0 && grams < 3) return { quantity: '1 Prise' };
  if (food.pieceG && food.pieceLabel) {
    const pieces = Math.max(1, Math.ceil(grams / food.pieceG - PIECE_TOLERANCE));
    const label = food.pieceLabel === 'Stück' || pieces === 1 ? food.pieceLabel : pluralize(food.pieceLabel);
    return { quantity: `${pieces} ${label}` };
  }
  const quantity = formatGrams(grams);
  if (food.packageG && grams > food.packageG * 0.6) {
    const packs = Math.ceil(grams / food.packageG);
    return { quantity, hint: packs === 1 ? `1 Packung (${formatGrams(food.packageG)})` : `${packs} × ${formatGrams(food.packageG)}` };
  }
  return { quantity };
}

function pluralize(label: string): string {
  const plurals: Record<string, string> = { Ei: 'Eier', Scheibe: 'Scheiben', Wrap: 'Wraps', Filet: 'Filets', Riegel: 'Riegel' };
  return plurals[label] ?? label;
}

export function groupByCategory<T extends { category: ShoppingCategory }>(items: T[]) {
  return CATEGORIES.map((c) => ({ ...c, items: items.filter((i) => i.category === c.id) })).filter((g) => g.items.length > 0);
}
