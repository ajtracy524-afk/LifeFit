import { getFood, LACTOSE_FREE_VARIANT } from '../data/foods';
import type { Intolerance } from './onboarding/types';
import type { AnimalKind, DietType, Food, FoodGroup, FoodTags, LmivAllergen, Macros, NutritionProfile, Recipe } from './types';

/**
 * Derived catalog facts (Prompt 3b, decisions E15–E23 in docs/ONBOARDING_PLAN.md).
 * Foods carry the tags (data/foods.ts); recipes never do – their allergens,
 * animal kinds and diet are always derived from the ingredients here, so a
 * recipe cannot contradict what it is made of.
 */

export type Diet = DietType | 'pescatarian';

const MEAT: AnimalKind[] = ['meat', 'pork'];
const SEAFOOD: AnimalKind[] = ['fish', 'crustaceans', 'molluscs'];
const ANIMAL_PRODUCTS: AnimalKind[] = ['egg', 'milk', 'honey'];

/** The strictest diet a set of animal kinds still fits. */
export function dietOf(kinds: AnimalKind[]): Diet {
  if (kinds.some((k) => MEAT.includes(k))) return 'omnivore';
  if (kinds.some((k) => SEAFOOD.includes(k))) return 'pescatarian';
  return kinds.some((k) => ANIMAL_PRODUCTS.includes(k)) ? 'vegetarian' : 'vegan';
}

/** Does a food with these animal kinds fit the diet? */
export function fitsDiet(kinds: AnimalKind[], diet: Diet): boolean {
  const order: Diet[] = ['vegan', 'vegetarian', 'pescatarian', 'omnivore'];
  return order.indexOf(dietOf(kinds)) <= order.indexOf(diet);
}

export interface RecipeTags {
  allergens: LmivAllergen[];
  traces: LmivAllergen[];
  kinds: AnimalKind[];
  diet: Diet;
  /** Ingredients that matter for the intolerances (food ids). */
  lactose: string[];
  fructose: string[];
  celiac: string[];
  alcohol?: 'fermentation' | 'added';
}

/**
 * The union of the ingredients' tags. Ingredients without tags (own products)
 * add nothing here – their declared facts are checked by recipeAllowed.
 */
export function recipeTags(recipe: Recipe): RecipeTags {
  const allergens = new Set<LmivAllergen>();
  const traces = new Set<LmivAllergen>();
  const kinds = new Set<AnimalKind>();
  const lactose = new Set<string>();
  const fructose = new Set<string>();
  const celiac = new Set<string>();
  let alcohol: RecipeTags['alcohol'];
  for (const ing of recipe.ingredients) {
    const t = getFood(ing.foodId)?.tags;
    if (!t) continue;
    t.allergens.forEach((a) => allergens.add(a));
    t.traces?.forEach((a) => traces.add(a));
    t.kinds.forEach((k) => kinds.add(k));
    if (t.lactose === 'yes') lactose.add(ing.foodId);
    if (t.fructose) fructose.add(ing.foodId);
    if (celiacRelevant(t)) celiac.add(ing.foodId);
    if (t.alcohol === 'added' || (t.alcohol === 'fermentation' && !alcohol)) alcohol = t.alcohol;
  }
  return {
    allergens: [...allergens],
    traces: [...traces].filter((a) => !allergens.has(a)),
    kinds: [...kinds],
    diet: dietOf([...kinds]),
    lactose: [...lactose],
    fructose: [...fructose],
    celiac: [...celiac],
    ...(alcohol ? { alcohol } : {}),
  };
}

/** Coeliac disease is stricter than a gluten allergy: traces and contamination risks count too. */
function celiacRelevant(t: FoodTags): boolean {
  return t.allergens.includes('gluten') || !!t.traces?.includes('gluten') || !!t.celiacRisk;
}

// ---------- Preference groups (E16) ----------

/** Group of the macro with the largest energy share (4 / 4 / 9 kcal per g); none without energy. */
export function computedGroup(per100: Macros): FoodGroup | undefined {
  const shares: [FoodGroup, number][] = [
    ['protein', per100.protein * 4],
    ['carbs', per100.carbs * 4],
    ['fat', per100.fat * 9],
  ];
  const [group, kcal] = shares.sort((a, b) => b[1] - a[1])[0]!;
  return kcal > 0 ? group : undefined;
}

/** Hybrid (E6): the reviewed override, otherwise the computed group. [] = condiment, not shown in the preferences. */
export function foodGroups(food: Food): FoodGroup[] {
  if (food.tags?.groups) return food.tags.groups;
  const g = computedGroup(food.per100);
  return g ? [g] : [];
}

// ---------- Hard exclusions (used by the filter from Prompt 4 on) ----------

export interface HardExclusions {
  diet?: Diet;
  allergens?: LmivAllergen[];
  /** Allergens for which traces are okay (E15) – traces are excluded by default. */
  tracesOk?: LmivAllergen[];
  intolerances?: Intolerance[];
  pork?: boolean;
  /** Excludes added alcohol AND alcohol from fermentation by default (E17). */
  alcohol?: boolean;
  fermentationAlcoholOk?: boolean;
}

/** Is the food itself excluded? Foods without tags (own products) are judged elsewhere. */
export function isExcluded(food: Food, ex: HardExclusions): boolean {
  const t = food.tags;
  if (!t) return false;
  if (ex.diet && !fitsDiet(t.kinds, ex.diet)) return true;
  if (ex.pork && t.kinds.includes('pork')) return true;
  const allergens = ex.allergens ?? [];
  if (t.allergens.some((a) => allergens.includes(a))) return true;
  if (t.traces?.some((a) => allergens.includes(a) && !ex.tracesOk?.includes(a))) return true;
  const intol = ex.intolerances ?? [];
  if (intol.includes('lactose') && t.lactose === 'yes') return true;
  if (intol.includes('fructose') && t.fructose) return true;
  if (intol.includes('celiac') && celiacRelevant(t)) return true;
  if (ex.alcohol && (t.alcohol === 'added' || (t.alcohol === 'fermentation' && !ex.fermentationAlcoholOk))) return true;
  return false;
}

/**
 * E20 – swap instead of exclude: with lactose intolerance (and no milk
 * allergy) milk, quark, skyr and Greek yogurt become their lactose-free
 * variant. Everything else stays as it is.
 */
export function substituteFood(foodId: string, ctx: { lactoseIntolerant: boolean; milkAllergy: boolean }): string {
  if (!ctx.lactoseIntolerant || ctx.milkAllergy) return foodId;
  return LACTOSE_FREE_VARIANT[foodId] ?? foodId;
}

/** The food the user can actually use for an ingredient: itself, its allowed variant, or none. */
export function usableFood(foodId: string, ex: HardExclusions): string | undefined {
  const food = getFood(foodId);
  if (!food) return undefined;
  if (!isExcluded(food, ex)) return foodId;
  const swapped = substituteFood(foodId, swapContext(ex));
  const variant = swapped !== foodId ? getFood(swapped) : undefined;
  return variant && !isExcluded(variant, ex) ? swapped : undefined;
}

/** A recipe is allowed when every ingredient is usable – possibly as its lactose-free variant. */
export function recipeAllowedBy(recipe: Recipe, ex: HardExclusions): boolean {
  return recipe.ingredients.every((ing) => usableFood(ing.foodId, ex) !== undefined);
}

function swapContext(ex: HardExclusions) {
  return { lactoseIntolerant: !!ex.intolerances?.includes('lactose'), milkAllergy: !!ex.allergens?.includes('milk') };
}

/**
 * The swap for the old profile (until Prompt 4): its "Laktose" exclusion is
 * an intolerance; a milk allergy cannot be expressed there yet.
 */
export function legacySwapContext(profile: Pick<NutritionProfile, 'excluded'> | null) {
  return { lactoseIntolerant: !!profile?.excluded.includes('lactose'), milkAllergy: false };
}

// ---------- Display ----------

/** Chips of a recipe: the typed facts first ("Meal Prep", "To go"), then the free tags. */
export function recipeLabels(recipe: Recipe): string[] {
  const typed: string[] = [];
  if (recipe.mealPrep) typed.push('Meal Prep');
  if (recipe.portable === 'yes') typed.push('To go');
  if (recipe.portable === 'chilled') typed.push('To go · Kühlung nötig');
  return [...typed, ...recipe.tags];
}
