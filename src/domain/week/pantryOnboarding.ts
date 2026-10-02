import { FOODS, getFood, LACTOSE_FREE_VARIANT } from '../../data/foods';
import { hardExclusionsOf, isExcluded, usableFood } from '../catalogTags';
import { PANTRY } from '../constants';
import { daysBetween } from '../dates';
import { suggestCatalogFoods } from '../foodEntry';
import { productFood } from '../personal';
import type { Food, ISODate, NutritionProfile, PantryItem, PantryLevel, Product } from '../types';

/**
 * "Was hast du schon zu Hause?" (Prompt 6) – pure rules for the basics
 * checklist and the serial scan. The pantry stays an ESTIMATE (week/pantry.ts):
 * nothing here fills it from what was eaten.
 */

export interface ChecklistGroup {
  id: string;
  label: string;
  items: ChecklistItem[];
}

export interface ChecklistItem {
  /** Stored in the pantry – the recipe ingredient (plan and stock keep one identity, E20). */
  foodId: string;
  /** Shown – the lactose-free variant for lactose intolerance. */
  name: string;
  /** Grundvorrat (salt, pepper, oil …): on the shopping list only when marked empty. */
  staple: boolean;
}

/** Frequent basics of the catalog, in the order a kitchen is checked. */
export const CHECKLIST: { id: string; label: string; foods: string[] }[] = [
  { id: 'fats', label: 'Öle & Fette', foods: ['olive-oil', 'peanut-butter'] },
  { id: 'spices', label: 'Gewürze & Würze', foods: ['salt', 'pepper', 'curry-powder', 'vinegar', 'soy-sauce', 'honey'] },
  { id: 'grains', label: 'Getreide & Nudeln', foods: ['oats', 'rice', 'pasta', 'couscous', 'quinoa'] },
  { id: 'canned', label: 'Konserven', foods: ['canned-tomato', 'corn', 'kidney', 'chickpeas', 'lentils', 'tuna'] },
  { id: 'dairy', label: 'Milchprodukte & Eier', foods: ['milk', 'quark', 'skyr', 'greek-yogurt', 'egg'] },
  { id: 'frozen', label: 'Tiefkühl', foods: ['berries', 'spinach', 'edamame'] },
];

/** The checklist after the hard exclusions (Prompt 4): what the user may not eat is not offered. */
export function checklistFor(profile: NutritionProfile | null): ChecklistGroup[] {
  const ex = hardExclusionsOf(profile);
  return CHECKLIST.map((g) => ({
    id: g.id,
    label: g.label,
    items: g.foods.flatMap((id): ChecklistItem[] => {
      const usable = usableFood(id, ex);
      if (!usable) return [];
      return [{ foodId: id, name: getFood(usable)!.name, staple: !!getFood(id)!.tags?.staple }];
    }),
  })).filter((g) => g.items.length > 0);
}

/** Grams a fill level stands for: a share of the catalog package (a "Rest" is never 0 – that is "leer"). */
export function levelGrams(food: Food, level: PantryLevel): number {
  const pack = food.packageG ?? food.pieceG ?? 100;
  return Math.max(1, Math.round(pack * PANTRY.level[level]));
}

/** Days until the best-before date (negative = past); undefined without a date. */
export function daysToExpiry(item: Pick<PantryItem, 'bestBefore'>, today: ISODate): number | undefined {
  return item.bestBefore ? daysBetween(today, item.bestBefore) : undefined;
}

// ---------- Serial scan ----------

/** Open Food Facts categories → catalog food (most specific first). Only a suggestion – the user confirms. */
const CATEGORY_FOOD: [string, string][] = [
  ['en:olive-oils', 'olive-oil'],
  ['en:peanut-butters', 'peanut-butter'],
  ['en:salts', 'salt'],
  ['en:black-peppers', 'pepper'],
  ['en:curry-powders', 'curry-powder'],
  ['en:vinegars', 'vinegar'],
  ['en:soy-sauces', 'soy-sauce'],
  ['en:honeys', 'honey'],
  ['en:rolled-oats', 'oats'],
  ['en:oat-flakes', 'oats'],
  ['en:basmati-rices', 'rice'],
  ['en:rices', 'rice'],
  ['en:wholemeal-pastas', 'pasta'],
  ['en:pastas', 'pasta'],
  ['en:couscous', 'couscous'],
  ['en:quinoa', 'quinoa'],
  ['en:chopped-tomatoes', 'canned-tomato'],
  ['en:canned-tomatoes', 'canned-tomato'],
  ['en:sweet-corns', 'corn'],
  ['en:red-kidney-beans', 'kidney'],
  ['en:chickpeas', 'chickpeas'],
  ['en:red-lentils', 'lentils'],
  ['en:lentils', 'lentils'],
  ['en:tunas', 'tuna'],
  ['en:skyr', 'skyr'],
  ['en:quark', 'quark'],
  ['en:greek-style-yogurts', 'greek-yogurt'],
  ['en:semi-skimmed-milks', 'milk'],
  ['en:milks', 'milk'],
  ['en:eggs', 'egg'],
  ['en:tofu', 'tofu'],
  ['en:frozen-spinachs', 'spinach'],
  ['en:frozen-berries', 'berries'],
  ['en:edamame', 'edamame'],
  ['en:feta', 'feta'],
  ['en:mozzarella', 'mozzarella'],
  ['en:goudas', 'gouda'],
  ['en:cottage-cheeses', 'cottage'],
  ['en:wraps', 'wrap'],
  ['en:rice-cakes', 'rice-cakes'],
  ['en:almonds', 'almonds'],
  ['en:whey-proteins', 'whey'],
  ['en:protein-bars', 'protein-bar'],
];

export interface FoodSuggestion {
  /** The pre-selected catalog food (remembered for this barcode, or the best guess). */
  foodId?: string;
  /** Alternatives to tap, the pre-selected one first. */
  candidates: string[];
  /** Why it is pre-selected. */
  reason?: 'remembered' | 'category' | 'name';
}

/**
 * Which catalog food is this product? Remembered per barcode (Product.foodId)
 * first, then the Open Food Facts category, then the name. Variants are
 * mapped to their original (the pantry keeps the recipe ingredient, E20).
 */
export function suggestFoodForProduct(product: Product): FoodSuggestion {
  const base = (id: string) => Object.entries(LACTOSE_FREE_VARIANT).find(([, v]) => v === id)?.[0] ?? id;
  const byName = suggestCatalogFoods(`${product.name} ${product.brand ?? ''}`, 4).map((f) => base(f.id));
  const byCategory = CATEGORY_FOOD.find(([tag]) => product.categories?.includes(tag))?.[1];
  const remembered = product.foodId && getFood(product.foodId) ? base(product.foodId) : undefined;
  const first = remembered ?? byCategory ?? byName[0];
  const candidates = [...new Set([first, ...(byCategory ? [byCategory] : []), ...byName].filter((x): x is string => !!x))].slice(0, 4);
  return {
    ...(first ? { foodId: first } : {}),
    candidates,
    ...(remembered ? { reason: 'remembered' as const } : byCategory ? { reason: 'category' as const } : first ? { reason: 'name' as const } : {}),
  };
}

/**
 * A scanned product that breaks a hard exclusion (declared allergen, trace,
 * stated diet, free text): it is kept – marked – but never used for the plan,
 * and it does not count as stock of its catalog food.
 */
export function productViolates(product: Product, profile: NutritionProfile | null): boolean {
  const food = productFood(product);
  if (!food) return !!product.lmivAllergens?.some((a) => hardExclusionsOf(profile).allergens?.includes(a));
  return isExcluded(food, hardExclusionsOf(profile));
}

/** Every catalog food a manual entry can pick (no lactose-free variants, no duplicates). */
export const PICKABLE_FOODS: Food[] = FOODS.filter((f) => !f.tags?.lactoseFree);
