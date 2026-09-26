import { getFood } from '../data/foods';
import type { Food, Recipe } from './types';
import { purchaseAmount } from './week/pantry';

/**
 * Estimated costs – derived from what is actually BOUGHT (whole packages or
 * pieces), never from exact recipe grams. Foods without a price stay unknown.
 */

/** Estimated price of buying `neededG` of a food (package logic applied); undefined if unknown. */
export function purchaseCost(food: Food, neededG: number): number | undefined {
  if (food.estPricePerKg === undefined || neededG <= 0) return food.estPricePerKg === undefined ? undefined : 0;
  return (purchaseAmount(food, neededG) / 1000) * food.estPricePerKg;
}

export interface CostEstimate {
  /** Sum of all priced purchases in EUR. */
  totalEur: number;
  /** Items to buy without a known price – the total is a lower bound then. */
  unpriced: number;
}

/** Estimate for a list of (foodId, grams still to buy). */
export function estimateCost(items: { foodId: string; grams: number }[]): CostEstimate {
  let totalEur = 0;
  let unpriced = 0;
  for (const { foodId, grams } of items) {
    if (grams <= 0) continue;
    const food = getFood(foodId);
    const cost = food ? purchaseCost(food, grams) : undefined;
    if (cost === undefined) unpriced++;
    else totalEur += cost;
  }
  return { totalEur, unpriced };
}

// ---------- Rough ranges (never presented as exact) ----------

/** Share of the weight that needs a price estimate before any number is shown. */
export const MIN_PRICED_SHARE = 0.8;

export interface CostRange {
  lowEur: number;
  highEur: number;
}

/**
 * Cost of ingredient amounts as a rounded range – the value of what is eaten
 * (grams × estimated price), no package rounding. Undefined when less than
 * MIN_PRICED_SHARE of the weight has a price: then LifeFit shows nothing
 * rather than a made-up number.
 */
export function ingredientCostRange(items: { foodId: string; grams: number }[]): CostRange | undefined {
  let total = 0;
  let priced = 0;
  let eur = 0;
  for (const { foodId, grams } of items) {
    if (grams <= 0) continue;
    total += grams;
    const price = getFood(foodId)?.estPricePerKg;
    if (price === undefined) continue;
    priced += grams;
    eur += (grams / 1000) * price;
  }
  if (total === 0 || priced / total < MIN_PRICED_SHARE) return undefined;
  // Estimates vary with shop and brand: −10 % … +15 %, rounded outwards.
  const low = eur * 0.9;
  const high = eur * 1.15;
  const step = high < 5 ? 0.5 : 1;
  return { lowEur: Math.floor(low / step) * step, highEur: Math.max(Math.ceil(high / step) * step, Math.floor(low / step) * step + step) };
}

/** "ca. 2–3 €", "ca. 30–36 €", "unter 1 €". */
export function formatCostRange(r: CostRange): string {
  const n = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  if (r.highEur <= 1) return 'unter 1 €';
  return `ca. ${n(r.lowEur)}–${n(r.highEur)} €`;
}

/** Rough cost of one planned portion of a recipe (undefined without reliable prices). */
export function recipeCostRange(recipe: Recipe, servings: number): CostRange | undefined {
  return ingredientCostRange(recipe.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams * servings })));
}
