import { RECIPES, getRecipe } from '../data/recipes';
import { newId } from '../lib/id';
import { recipeAllowed, recipeMacros, roundServings, plannedMealMacros, sumMacros } from './nutrition';
import type { ISODate, Macros, MealSlot, NutritionProfile, PlannedMeal, Recipe } from './types';

export const SLOT_ORDER: MealSlot[] = ['breakfast', 'snack', 'lunch', 'dinner'];

/** Share of the day's calories per slot – used to size a single added meal. */
const SLOT_SHARE: Record<MealSlot, number> = { breakfast: 0.25, snack: 0.15, lunch: 0.32, dinner: 0.28 };

export function slotsFor(mealsPerDay: 3 | 4): MealSlot[] {
  return mealsPerDay === 3 ? ['breakfast', 'lunch', 'dinner'] : SLOT_ORDER;
}

export function recipesForSlot(slot: MealSlot, profile: NutritionProfile | null): Recipe[] {
  return RECIPES.filter((r) => r.slots.includes(slot) && recipeAllowed(r, profile));
}

/** Servings so that one meal fills its usual share of the daily target. */
export function servingsForSlot(recipe: Recipe, slot: MealSlot, target: Macros, slots: MealSlot[]): number {
  const shareSum = slots.reduce((s, sl) => s + SLOT_SHARE[sl], 0) || 1;
  const kcalGoal = (target.kcal * SLOT_SHARE[slot]) / shareSum;
  const base = recipeMacros(recipe).kcal || 1;
  return roundServings(kcalGoal / base);
}

interface SuggestInput {
  dates: ISODate[];
  slots: MealSlot[];
  target: Macros;
  /** Day-specific target (training / rest day). Falls back to `target`. */
  targetFor?: (date: ISODate) => Macros | undefined;
  profile: NutritionProfile | null;
  existing: PlannedMeal[];
  random?: () => number;
}

/**
 * Rule-based week suggestion. Fills only EMPTY slots, keeps what the user planned,
 * prefers variety and chooses combinations that hit calories and protein.
 */
export function suggestWeek({ dates, slots, target: baseTarget, targetFor, profile, existing, random = Math.random }: SuggestInput): PlannedMeal[] {
  const usage = new Map<string, number>();
  for (const m of existing) usage.set(m.recipeId, (usage.get(m.recipeId) ?? 0) + 1);

  const result: PlannedMeal[] = [];

  for (const date of dates) {
    const target = targetFor?.(date) ?? baseTarget;
    const dayExisting = existing.filter((m) => m.date === date);
    // Slots without any matching recipe (strict diet combinations) stay empty
    // instead of blocking the whole day.
    const emptySlots = slots.filter((s) => !dayExisting.some((m) => m.slot === s) && recipesForSlot(s, profile).length > 0);
    if (emptySlots.length === 0) continue;

    const fixed = sumMacros(dayExisting.map(plannedMealMacros));
    const remainingKcal = Math.max(target.kcal - fixed.kcal, target.kcal * 0.2);

    let best: { picks: Recipe[]; factor: number; score: number } | null = null;

    for (let attempt = 0; attempt < 60; attempt++) {
      const picks: Recipe[] = [];
      for (const slot of emptySlots) {
        const all = recipesForSlot(slot, profile);
        const unused = all.filter((r) => !picks.includes(r));
        const options = unused.length > 0 ? unused : all;
        // Weighted random: recipes used less this week are more likely.
        const weights = options.map((r) => 1 / (1 + 2 * (usage.get(r.id) ?? 0)));
        let roll = random() * weights.reduce((a, b) => a + b, 0);
        let chosen = options[0]!;
        for (let i = 0; i < options.length; i++) {
          roll -= weights[i]!;
          if (roll <= 0) {
            chosen = options[i]!;
            break;
          }
        }
        picks.push(chosen);
      }

      const base = sumMacros(picks.map((r) => recipeMacros(r)));
      const factor = remainingKcal / (base.kcal || 1);
      const protein = fixed.protein + base.protein * factor;
      const proteinGap = Math.max(0, target.protein - protein) / target.protein;
      const repeatPenalty = picks.reduce((s, r) => s + (usage.get(r.id) ?? 0), 0) * 0.04;
      const extremeServing = Math.abs(Math.log(factor)) * 0.1;
      const score = proteinGap + repeatPenalty + extremeServing;

      if (!best || score < best.score) best = { picks, factor, score };
    }

    if (!best) continue;

    best.picks.forEach((recipe, i) => {
      usage.set(recipe.id, (usage.get(recipe.id) ?? 0) + 1);
      result.push({
        id: newId(),
        date,
        slot: emptySlots[i]!,
        recipeId: recipe.id,
        servings: roundServings(best!.factor),
        status: 'planned',
        source: 'suggest',
      });
    });
  }

  return result;
}

export interface SwapOption {
  recipe: Recipe;
  servings: number;
  macros: Macros;
  proteinDelta: number;
}

/** Alternatives for a planned meal, scaled to the same calories, ranked by protein match. */
export function swapOptions(meal: PlannedMeal, profile: NutritionProfile | null, limit = 4): SwapOption[] {
  const current = getRecipe(meal.recipeId);
  if (!current) return [];
  const original = recipeMacros(current, meal.servings);

  return recipesForSlot(meal.slot, profile)
    .filter((r) => r.id !== current.id)
    .map((recipe) => {
      const servings = roundServings(original.kcal / (recipeMacros(recipe).kcal || 1));
      const macros = recipeMacros(recipe, servings);
      return { recipe, servings, macros, proteinDelta: macros.protein - original.protein };
    })
    .sort((a, b) => Math.abs(a.proteinDelta) - Math.abs(b.proteinDelta))
    .slice(0, limit);
}
