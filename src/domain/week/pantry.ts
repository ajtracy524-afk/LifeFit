import { getRecipe } from '../../data/recipes';
import { PIECE_TOLERANCE } from '../shopping';
import type { AppState, Food, LogEntry } from '../types';

/**
 * Pantry = deliberately an ESTIMATE, never an inventory system.
 *
 * Stored per food: the amount at `updatedAt`. Consumption is not stored a
 * second time – it is derived from log entries logged after `updatedAt`.
 * So "eaten" → pantry goes down, "undo eaten" → pantry is back, automatically.
 * Every write (purchase, correction) folds the current estimate into a new
 * stored amount.
 */

/** Ingredient grams of one log entry. Quick entries have no ingredients. */
export function entryIngredients(entry: LogEntry): { foodId: string; grams: number }[] {
  if (entry.foodId && entry.grams) return [{ foodId: entry.foodId, grams: entry.grams }];
  if (entry.recipeId) {
    const recipe = getRecipe(entry.recipeId);
    const servings = entry.servings ?? 1;
    return recipe ? recipe.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams * servings })) : [];
  }
  return [];
}

const time = (iso: string) => Date.parse(iso);

/** Current estimate per food in grams (≥ 0). Only foods in the pantry appear. */
export function pantryEstimate(state: Pick<AppState, 'pantry' | 'logEntries'>): Record<string, number> {
  const result: Record<string, number> = {};
  const items = Object.values(state.pantry);
  if (items.length === 0) return result;
  for (const item of items) result[item.foodId] = item.quantityG;

  for (const entry of state.logEntries) {
    const at = time(entry.loggedAt);
    for (const { foodId, grams } of entryIngredients(entry)) {
      const item = state.pantry[foodId];
      if (item && at > time(item.updatedAt)) result[foodId] = result[foodId]! - grams;
    }
  }
  for (const id of Object.keys(result)) result[id] = Math.max(0, Math.round(result[id]!));
  return result;
}

/** Sets the pantry amount of a food. `null` or ≤ 0 removes it ("leer"). Mutates the draft. */
export function setPantryQuantity(draft: AppState, foodId: string, grams: number | null, nowIso: string): void {
  if (grams === null || grams <= 0) {
    delete draft.pantry[foodId];
    return;
  }
  draft.pantry[foodId] = { foodId, quantityG: Math.round(grams), updatedAt: nowIso };
}

/** Adds (or with negative grams removes) an amount on top of the current estimate. Mutates the draft. */
export function addToPantry(draft: AppState, foodId: string, grams: number, nowIso: string): void {
  const current = pantryEstimate(draft)[foodId] ?? 0;
  setPantryQuantity(draft, foodId, current + grams, nowIso);
}

/**
 * What a purchase of `neededG` adds to the pantry: whole pieces or whole
 * packages – the rest stays in the pantry for later meals.
 */
export function purchaseAmount(food: Food, neededG: number): number {
  if (neededG <= 0) return 0;
  // Packages first: eggs, bread and wraps are sold by the pack, not by the piece.
  if (food.packageG) return Math.ceil(neededG / food.packageG) * food.packageG;
  if (food.pieceG) return Math.max(1, Math.ceil(neededG / food.pieceG - PIECE_TOLERANCE)) * food.pieceG;
  return Math.round(neededG);
}
