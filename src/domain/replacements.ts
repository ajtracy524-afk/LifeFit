import { getRecipe } from '../data/recipes';
import type { AppState, LogEntry, PlannedMeal } from './types';

/**
 * "Zuletzt als Ersatz" – derived from what already happened, no second model:
 *   recipe swaps   → plannedMeals with replacedRecipeId (from → to)
 *   eaten instead  → logEntries with replacedMealId (skipped meal → entry)
 * Ranked by how well a past replacement matches the meal at hand (same
 * original dish first, then same slot), how often it happened and how recent.
 */
export type Replacement =
  | { kind: 'recipe'; recipeId: string; count: number }
  | { kind: 'entry'; entry: LogEntry; count: number };

export function replacementHistory(state: Pick<AppState, 'plannedMeals' | 'logEntries'>, meal: PlannedMeal, limit = 3): Replacement[] {
  const byId = new Map(state.plannedMeals.map((m) => [m.id, m]));
  const found = new Map<string, { item: Replacement; weight: number; last: string }>();
  const add = (key: string, item: Replacement, from: string | undefined, slot: PlannedMeal['slot'], at: string) => {
    const weight = (from === meal.recipeId ? 2 : 0) + (slot === meal.slot ? 1 : 0);
    const known = found.get(key);
    if (known) {
      known.item.count++;
      known.weight = Math.max(known.weight, weight);
      if (at > known.last) {
        known.last = at;
        if (item.kind === 'entry' && known.item.kind === 'entry') known.item.entry = item.entry;
      }
    } else found.set(key, { item, weight, last: at });
  };

  for (const m of state.plannedMeals) {
    if (m.id === meal.id || !m.replacedRecipeId || m.recipeId === meal.recipeId || !getRecipe(m.recipeId)) continue;
    add(`r:${m.recipeId}`, { kind: 'recipe', recipeId: m.recipeId, count: 1 }, m.replacedRecipeId, m.slot, m.date);
  }
  for (const e of state.logEntries) {
    if (!e.replacedMealId) continue;
    const original = byId.get(e.replacedMealId);
    // One key per thing eaten: product, catalog food or the manual entry's name.
    const key = e.barcode ? `b:${e.barcode}` : e.foodId && e.method === 'food' ? `f:${e.foodId}` : `n:${e.name.toLowerCase()}`;
    add(key, { kind: 'entry', entry: e, count: 1 }, original?.recipeId, e.slot, e.loggedAt);
  }

  return [...found.values()]
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight || b.item.count - a.item.count || b.last.localeCompare(a.last))
    .slice(0, limit)
    .map((x) => x.item);
}
