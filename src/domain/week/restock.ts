import { RESTOCK_MINIMUM_G } from '../../data/basics';
import { getFood, isStaple } from '../../data/foods';
import { weekStart } from '../dates';
import { foodAllowed } from '../nutrition';
import { describeQuantity, PIECE_TOLERANCE, type ShoppingListItem } from '../shopping';
import type { AppState, ISODate } from '../types';

/**
 * F8 – restock of basics. NOT a second list and NOT a second pantry: it only
 * raises the target stock of a basic on the regular shopping list:
 *
 *   to buy = plan need + minimum stock − free pantry
 *
 * One position per food, the normal package logic applies when buying.
 * A basic is restocked only if the user keeps it (it has a pantry entry),
 * it fits the diet, and it was not skipped for this week. Restock applies to
 * the list of the current week – the next shopping trip.
 */
export interface RestockRule {
  foodId: string;
  minimumG: number;
}

/** The basics that are restocked for `week` – the one central definition. */
export function restockRules(state: AppState, week: ISODate, today: ISODate): RestockRule[] {
  if (week !== weekStart(today)) return [];
  const skipped = new Set(state.shopping[week]?.restockSkipped ?? []);
  return Object.entries(RESTOCK_MINIMUM_G)
    .filter(([foodId]) => state.pantry[foodId] !== undefined && !skipped.has(foodId))
    .filter(([foodId]) => {
      const food = getFood(foodId);
      return !!food && foodAllowed(food, state.nutritionProfile);
    })
    .map(([foodId, minimumG]) => ({ foodId, minimumG }));
}

/**
 * Adds the minimum stock to the (already pantry-adjusted) shopping items.
 * Items the plan needs anyway grow by what is missing to the minimum; basics
 * the plan does not need appear on their own.
 */
export function applyRestock(
  items: ShoppingListItem[],
  rules: RestockRule[],
  available: Record<string, number>,
  purchased: Record<string, number>,
): ShoppingListItem[] {
  const result = [...items];
  for (const { foodId, minimumG } of rules) {
    const food = getFood(foodId)!;
    const index = result.findIndex((i) => i.foodId === foodId);
    const planNeed = index >= 0 ? result[index]!.neededG : 0;
    const shortfall = planNeed + minimumG - (available[foodId] ?? 0);
    const covered = shortfall < Math.max(1, (food.pieceG ?? 0) * PIECE_TOLERANCE);
    const remainingG = covered ? 0 : shortfall;

    if (index >= 0) {
      const item = result[index]!;
      if (remainingG <= item.remainingG) {
        result[index] = { ...item, restockMinG: minimumG };
        continue;
      }
      const q = describeQuantity(food, remainingG);
      result[index] = { ...item, state: 'open', remainingG, restockMinG: minimumG, restockG: remainingG - item.remainingG, quantity: q.quantity, hint: q.hint };
      continue;
    }

    if (remainingG > 0) {
      const q = describeQuantity(food, remainingG);
      result.push({ foodId, name: food.name, category: food.category, grams: 0, neededG: 0, remainingG, quantity: q.quantity, hint: q.hint, sources: [], state: 'open', restockMinG: minimumG, restockG: remainingG });
    } else if (purchased[foodId]) {
      // Bought this week for the stock – shown as done.
      const q = describeQuantity(food, purchased[foodId]!);
      result.push({ foodId, name: food.name, category: food.category, grams: 0, neededG: 0, remainingG: 0, quantity: q.quantity, sources: [], state: 'checked', restockMinG: minimumG });
    }
  }
  return result;
}

/**
 * E19 – staples (salt, pepper, spices, vinegar) are assumed to be at home.
 * They are recipe ingredients, but appear on the list only when the pantry
 * marks them as empty ("aufgebraucht", 0 g) – then as one package. Bought
 * this week → shown as done. Without a pantry entry they never appear.
 */
export function applyStaples(
  items: ShoppingListItem[],
  pantry: AppState['pantry'],
  available: Record<string, number>,
  purchased: Record<string, number>,
): ShoppingListItem[] {
  const empty = (id: string) => pantry[id] !== undefined && (available[id] ?? 0) <= 0;
  const result = items.filter((i) => !isStaple(i.foodId));
  const staples = new Set([...items.map((i) => i.foodId).filter(isStaple), ...Object.keys(pantry).filter(isStaple)]);
  for (const foodId of staples) {
    const food = getFood(foodId)!;
    const fromPlan = items.find((i) => i.foodId === foodId);
    const base = { foodId, name: food.name, category: food.category, grams: fromPlan?.grams ?? 0, neededG: fromPlan?.neededG ?? 0, sources: fromPlan?.sources ?? [] };
    if (purchased[foodId]) {
      result.push({ ...base, remainingG: 0, quantity: describeQuantity(food, purchased[foodId]!).quantity, state: 'checked' });
    } else if (empty(foodId)) {
      const remainingG = Math.max(food.packageG ?? 0, fromPlan?.neededG ?? 0);
      const q = describeQuantity(food, remainingG);
      result.push({ ...base, remainingG, quantity: q.quantity, hint: q.hint, state: 'open' });
    }
  }
  return result;
}
