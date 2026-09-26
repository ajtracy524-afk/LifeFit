import { getFood } from '../data/foods';
import { getRecipe } from '../data/recipes';
import { STYLE_DENSITY, TASTE_RECIPES, TASTES, type Taste } from '../data/tastes';
import { affinityIndex, preferenceOf, prefKey, type Preferences } from './learning';
import { recipeMacros } from './nutrition';
import type { MealStyle, NutritionProfile, Recipe, TimeBudget } from './types';

/**
 * What the planner knows about the user's taste, in ONE lookup:
 *
 *   learned recipe affinity (learning.ts, −1 … +1)
 *   + food signals: foods eaten outside the plan push recipes containing them
 *   + explicit favourites: a starting point that fades as evidence grows
 *   + meal style: light / hearty recipes for the user's kind of day
 *   explicitly avoided → a strong fixed penalty, stronger than anything learned
 *
 * Built once per planning run; scoring a candidate stays a map lookup.
 */
export const EXPLICIT = {
  /** Bonus of a favourite without any evidence – fades with the recipe's learned confidence. */
  favorite: 0.35,
  /** Bonus for recipes of the chosen meal style. */
  style: 0.2,
  /** Affinity of an avoided recipe. Learned values are bounded to ±1, so this always wins. */
  avoided: -4,
  /** Share of the summed food signals that reaches a recipe. */
  foodShare: 0.5,
} as const;

/** Pantry basics (oil, spices …) say nothing about taste. */
const isTasteRelevant = (foodId: string) => getFood(foodId)?.category !== 'pantry';

const densityCache = new Map<string, number>();
/** kcal per 100 g of one serving. */
export function recipeDensity(recipe: Recipe): number {
  let d = densityCache.get(recipe.id);
  if (d === undefined) {
    const grams = recipe.ingredients.reduce((s, i) => s + i.grams, 0) || 1;
    d = (recipeMacros(recipe).kcal / grams) * 100;
    densityCache.set(recipe.id, d);
  }
  return d;
}

export function recipeStyle(recipe: Recipe): MealStyle {
  const d = recipeDensity(recipe);
  return d <= STYLE_DENSITY.lightMax ? 'light' : d >= STYLE_DENSITY.heartyMin ? 'hearty' : 'balanced';
}

/** Tastes of the user's lists that a recipe matches. */
export function matchingTastes(recipeId: string, ids: string[] | undefined): Taste[] {
  if (!ids?.length) return [];
  return TASTES.filter((t) => ids.includes(t.id) && TASTE_RECIPES.get(t.id)?.has(recipeId));
}

/** Summed food signal of a recipe's taste-relevant ingredients (score × confidence, capped to ±1). */
export function foodSignal(prefs: Preferences, recipe: Recipe): number {
  let sum = 0;
  for (const i of recipe.ingredients) {
    if (!isTasteRelevant(i.foodId)) continue;
    const p = preferenceOf(prefs[prefKey.food(i.foodId)]);
    sum += p.score * p.confidence;
  }
  return Math.max(-1, Math.min(1, sum));
}

export function plannerAffinity(prefs: Preferences, profile: Pick<NutritionProfile, 'favorites' | 'avoided' | 'mealStyle'> | null): (recipeId: string, budget: TimeBudget) => number {
  const learned = affinityIndex(prefs);
  const favorites = profile?.favorites ?? [];
  const avoided = profile?.avoided ?? [];
  const style = profile?.mealStyle && profile.mealStyle !== 'balanced' ? profile.mealStyle : undefined;
  const hasFood = Object.keys(prefs).some((k) => k.startsWith('food:'));
  // Without explicit input or food signals nothing changes – exactly the learned index.
  if (!favorites.length && !avoided.length && !style && !hasFood) return learned;

  // Budget-independent part per recipe, computed on first use.
  const base = new Map<string, { avoided: boolean; bonus: number; favorite: boolean }>();
  const baseOf = (recipeId: string) => {
    let b = base.get(recipeId);
    if (!b) {
      const recipe = getRecipe(recipeId);
      const favorite = matchingTastes(recipeId, favorites).length > 0;
      b = {
        avoided: matchingTastes(recipeId, avoided).length > 0,
        favorite,
        bonus: recipe ? (style && recipeStyle(recipe) === style ? EXPLICIT.style : 0) + (hasFood ? EXPLICIT.foodShare * foodSignal(prefs, recipe) : 0) : 0,
      };
      base.set(recipeId, b);
    }
    return b;
  };
  const cache: Partial<Record<TimeBudget, Map<string, number>>> = {};
  return (recipeId, budget) => {
    const byRecipe = (cache[budget] ??= new Map());
    let value = byRecipe.get(recipeId);
    if (value === undefined) {
      const b = baseOf(recipeId);
      const l = learned(recipeId, budget);
      if (b.avoided) value = EXPLICIT.avoided + l;
      else {
        // A favourite is a prior: the more real evidence about the recipe, the less it counts.
        const confidence = preferenceOf(prefs[prefKey.recipe(recipeId)]).confidence;
        value = l + b.bonus + (b.favorite ? EXPLICIT.favorite * (1 - confidence) : 0);
      }
      byRecipe.set(recipeId, value);
    }
    return value;
  };
}
