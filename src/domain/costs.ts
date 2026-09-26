import { getFood } from '../data/foods';
import type { Food, Product, Recipe } from './types';
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
  /** Sum of all priced purchases in CHF. */
  totalChf: number;
  /** Items to buy without a known price – the total is a lower bound then. */
  unpriced: number;
}

/** Estimate for a list of (foodId, grams still to buy). */
export function estimateCost(items: { foodId: string; grams: number }[]): CostEstimate {
  let totalChf = 0;
  let unpriced = 0;
  for (const { foodId, grams } of items) {
    if (grams <= 0) continue;
    const food = getFood(foodId);
    const cost = food ? purchaseCost(food, grams) : undefined;
    if (cost === undefined) unpriced++;
    else totalChf += cost;
  }
  return { totalChf, unpriced };
}

// ---------- Rough ranges (never presented as exact) ----------

/** Share of the weight that needs a price estimate before any number is shown. */
export const MIN_PRICED_SHARE = 0.8;

export interface CostRange {
  lowChf: number;
  highChf: number;
}

/** Price of a food per kg in CHF – real (entered by the user) or estimated (catalog). */
export type PriceLookup = (foodId: string) => { perKgChf: number; exact: boolean } | undefined;

/** Catalog estimates only. */
export const catalogPrice: PriceLookup = (foodId) => {
  const p = getFood(foodId)?.estPricePerKg;
  return p === undefined ? undefined : { perKgChf: p, exact: false };
};

/**
 * The ONE price source for costs: the latest real price the user entered for
 * a scanned product linked to the food, otherwise the catalog estimate.
 * Build once per render/computation – lookups are then map reads.
 */
export function priceLookup(products: Record<string, Product> | undefined): PriceLookup {
  const real = new Map<string, { perKgChf: number; at: string }>();
  for (const p of Object.values(products ?? {})) {
    if (!p.foodId || !p.price || p.price.amount <= 0) continue;
    const known = real.get(p.foodId);
    if (!known || p.price.at > known.at) real.set(p.foodId, { perKgChf: (p.price.chf / p.price.amount) * 1000, at: p.price.at });
  }
  if (real.size === 0) return catalogPrice;
  return (foodId) => {
    const r = real.get(foodId);
    return r ? { perKgChf: r.perKgChf, exact: true } : catalogPrice(foodId);
  };
}

/** One cost item: a food amount (priced via the lookup) or an amount with a known real cost. */
export type CostItem = { foodId: string; grams: number } | { grams: number; exactChf: number };

/**
 * Cost of amounts as a rounded range – the value of what is eaten (grams ×
 * price), no package rounding. Real prices count exactly, estimates with a
 * margin (−10 % … +15 %). Undefined when less than MIN_PRICED_SHARE of the
 * weight has a price: then LifeFit shows nothing rather than a made-up number.
 */
export function ingredientCostRange(items: CostItem[], price: PriceLookup = catalogPrice): CostRange | undefined {
  let total = 0;
  let priced = 0;
  let exact = 0;
  let estimate = 0;
  for (const item of items) {
    if ('exactChf' in item) {
      // A real amount always counts – with an unknown weight (e.g. "1 Portion") it just does not
      // take part in the weight coverage.
      exact += item.exactChf;
      if (item.grams > 0) {
        total += item.grams;
        priced += item.grams;
      }
      continue;
    }
    if (item.grams <= 0) continue;
    total += item.grams;
    const p = price(item.foodId);
    if (!p) continue;
    priced += item.grams;
    if (p.exact) exact += (item.grams / 1000) * p.perKgChf;
    else estimate += (item.grams / 1000) * p.perKgChf;
  }
  if (total === 0 ? exact === 0 : priced / total < MIN_PRICED_SHARE) return undefined;
  const low = exact + estimate * 0.9;
  const high = exact + estimate * 1.15;
  const step = high < 5 ? 0.5 : 1;
  return { lowChf: Math.floor(low / step) * step, highChf: Math.max(Math.ceil(high / step) * step, Math.floor(low / step) * step + step) };
}

/** Swiss number format: 4.95, 1’250. */
const chfNumber = (v: number, digits: number) => v.toLocaleString('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** An exact amount (e.g. a price the user entered): "4.95 CHF". */
export function formatChf(v: number): string {
  // Never "0.00 CHF" for a tiny but real amount.
  if (v > 0 && v < 0.05) return 'unter 0.05 CHF';
  return `${chfNumber(v, 2)} CHF`;
}

/** "ca. 2–3 CHF", "ca. 1.5–2 CHF", "unter 1 CHF". */
export function formatCostRange(r: CostRange): string {
  const n = (v: number) => chfNumber(v, Number.isInteger(v) ? 0 : 1);
  if (r.highChf <= 1) return 'unter 1 CHF';
  return `ca. ${n(r.lowChf)}–${n(r.highChf)} CHF`;
}

/** Rough cost of one planned portion of a recipe (undefined without reliable prices). */
export function recipeCostRange(recipe: Recipe, servings: number, price: PriceLookup = catalogPrice): CostRange | undefined {
  return ingredientCostRange(recipe.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams * servings })), price);
}
