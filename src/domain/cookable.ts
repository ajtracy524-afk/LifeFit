import { allRecipes } from '../data/recipes';
import { getFood } from '../data/foods';
import { dayTotals, recipeAllowed, recipeMacros } from './nutrition';
import { DEFAULT_SLOTS, servingsForSlot } from './planner';
import { matchingTastes } from './preferences';
import { maxPrepFor } from './timeBudget';
import type { AppState, ISODate, Macros, MealSlot, Recipe } from './types';
import { dayContextFor, dayTargetFor, pantryEstimate, trainingDayBonus } from './week';

/**
 * "Was kann ich kochen?" – recipes ranked by what is at home. Rule-based,
 * local, instant (no AI, no network):
 *
 *   fewer missing ingredients first → higher share of what is at home
 *   → fits today's cooking time → fits the calories still open today
 *
 * Hard filters as everywhere: diet, allergens, avoided tastes. Only recipes
 * that use at least one of the chosen ingredients are shown.
 */
export interface CookOption {
  recipe: Recipe;
  slot: MealSlot;
  servings: number;
  macros: Macros;
  have: string[];
  missing: string[];
  /** Share of the recipe's ingredients that are at home (0 … 1). */
  coverage: number;
  fitsTime: boolean;
  score: number;
  /** "💪 42 g Protein – passt zum Beintag" – only when it is true. */
  because: string[];
}

export const COOK_RULES = {
  missingWeight: 1,
  coverageWeight: 2,
  tooLongWeight: 1.5,
  kcalWeight: 0.5,
  /** Training day: protein below this share of the day's protein per meal counts as a shortfall. */
  trainingProteinWeight: 1,
} as const;

/** Foods at home to start with: what the pantry estimate says is still there. */
export function atHome(state: AppState): string[] {
  const stock = pantryEstimate(state);
  return Object.keys(stock).filter((id) => stock[id]! > 0 && getFood(id));
}

/** All ingredients of the recipes the user may eat – the choices of the picker. */
export function cookIngredients(state: AppState): string[] {
  const ids = new Set(allRecipes().filter((r) => allowed(state, r)).flatMap((r) => r.ingredients.map((i) => i.foodId)));
  return [...ids].filter((id) => getFood(id)).sort((a, b) => getFood(a)!.name.localeCompare(getFood(b)!.name, 'de'));
}

const allowed = (state: AppState, r: Recipe) => recipeAllowed(r, state.nutritionProfile) && !matchingTastes(r.id, state.nutritionProfile?.avoided).length;

export function cookableRecipes(state: AppState, date: ISODate, have: ReadonlySet<string>, limit = 8): CookOption[] {
  if (!have.size) return [];
  const R = COOK_RULES;
  const target = dayTargetFor(state, date);
  const slots = state.nutritionProfile?.slots ?? DEFAULT_SLOTS;
  const used = new Set(state.plannedMeals.filter((m) => m.date === date && m.status !== 'skipped').map((m) => m.slot));
  const maxPrep = maxPrepFor(state.plannerSettings, dayContextFor(state, date), date);
  const openKcal = target ? Math.max(0, target.kcal - dayTotals(state.logEntries, date).kcal) : undefined;
  // Training day (planned or done): protein per meal matters more – from the day's own protein target.
  const training = trainingDayBonus(state, date);
  const proteinPerMeal = target ? target.protein / Math.max(1, slots.length) : 0;

  return allRecipes().filter((r) => allowed(state, r))
    .map((recipe): CookOption | undefined => {
      const ids = recipe.ingredients.map((i) => i.foodId);
      const haveIds = ids.filter((id) => have.has(id));
      if (!haveIds.length) return undefined;
      const missing = ids.filter((id) => !have.has(id));
      const coverage = haveIds.length / ids.length;
      // The next free slot this recipe fits, else its first slot.
      const slot = recipe.slots.find((s) => slots.includes(s) && !used.has(s)) ?? recipe.slots.find((s) => slots.includes(s)) ?? recipe.slots[0]!;
      const servings = target ? servingsForSlot(recipe, slot, target, slots) : 1;
      const macros = recipeMacros(recipe, servings);
      const fitsTime = recipe.prepMin <= maxPrep;
      const kcalMiss = openKcal ? Math.max(0, macros.kcal - openKcal) / Math.max(openKcal, 1) : 0;
      const proteinShort = training && proteinPerMeal ? Math.max(0, proteinPerMeal - macros.protein) / proteinPerMeal : 0;
      const score = R.missingWeight * missing.length + R.coverageWeight * (1 - coverage) + (fitsTime ? 0 : R.tooLongWeight) + R.kcalWeight * kcalMiss + R.trainingProteinWeight * proteinShort;
      const because = training && proteinPerMeal && macros.protein >= proteinPerMeal ? [`💪 ${Math.round(macros.protein)} g Protein – passt zum ${training.label === 'Beintag' ? 'Beintag' : 'Trainingstag'}`] : [];
      return { recipe, slot, servings, macros, have: haveIds, missing, coverage, fitsTime, score, because };
    })
    .filter((o): o is CookOption => !!o)
    .sort((a, b) => a.score - b.score || a.recipe.prepMin - b.recipe.prepMin)
    .slice(0, limit);
}
