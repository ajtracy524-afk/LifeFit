import { getFood } from '../data/foods';
import type { Food } from './types';
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
