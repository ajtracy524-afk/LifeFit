import { getRecipe } from '../../data/recipes';
import { PIECE_TOLERANCE } from '../shopping';
import type { AppState, Food, ISODate, LogEntry, PantryLevel } from '../types';

/**
 * Pantry = deliberately an ESTIMATE, never an inventory system.
 *
 * Stored per food: the amount at `updatedAt`. Consumption is not stored a
 * second time – it is derived from log entries logged after `updatedAt`.
 * So "eaten" → pantry goes down, "undo eaten" → pantry is back, automatically.
 * Every write (purchase, correction) folds the current estimate into a new
 * stored amount.
 */

/**
 * Ingredient grams of one log entry. Quick entries have no ingredients; a
 * scanned or manual entry counts only with a catalog food and a weight, and
 * never when the user said it did not come from the pantry. One entry is
 * subtracted exactly once – there is no second booking anywhere.
 */
export function entryIngredients(entry: LogEntry): { foodId: string; grams: number }[] {
  if (entry.fromPantry === false) return [];
  if (entry.foodId && entry.grams) return [{ foodId: entry.foodId, grams: entry.grams }];
  // An own dish: its catalog-linked ingredients (unlinked ones have no pantry item).
  if (entry.ingredients?.length) return entry.ingredients.filter((i) => i.foodId && i.grams > 0);
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

/**
 * Sets the pantry amount of a food. `null` removes it from the pantry (not kept
 * at home any more); 0 means "aufgebraucht" – the food stays known, so a basic
 * can be restocked. Mutates the draft.
 */
export function setPantryQuantity(draft: AppState, foodId: string, grams: number | null, nowIso: string, extra: { level?: PantryLevel; bestBefore?: ISODate } = {}): void {
  if (grams === null) {
    delete draft.pantry[foodId];
    return;
  }
  // A known best-before date stays until the stock is used up (Prompt 6); the fill level only as entered.
  const bestBefore = extra.bestBefore ?? (grams > 0 ? draft.pantry[foodId]?.bestBefore : undefined);
  draft.pantry[foodId] = { foodId, quantityG: Math.max(0, Math.round(grams)), updatedAt: nowIso, ...(extra.level ? { level: extra.level } : {}), ...(bestBefore ? { bestBefore } : {}) };
}

/** Adds (or with negative grams removes) an amount on top of the current estimate. Mutates the draft. */
export function addToPantry(draft: AppState, foodId: string, grams: number, nowIso: string, bestBefore?: ISODate): void {
  const current = pantryEstimate(draft)[foodId] ?? 0;
  // The earlier best-before date counts – that pack is used first.
  const known = draft.pantry[foodId]?.bestBefore;
  const earliest = bestBefore && known ? (bestBefore < known ? bestBefore : known) : (bestBefore ?? known);
  // Taking back a purchase down to nothing removes the entry again.
  setPantryQuantity(draft, foodId, current + grams > 0 ? current + grams : null, nowIso, earliest ? { bestBefore: earliest } : {});
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
