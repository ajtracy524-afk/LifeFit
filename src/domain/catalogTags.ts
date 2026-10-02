import { getFood, LACTOSE_FREE_VARIANT } from '../data/foods';
import type { Allergen, AnimalKind, DietType, Food, FoodGroup, FoodTags, Intolerance, LmivAllergen, Macros, MealSlot, NutritionProfile, Recipe } from './types';

/**
 * Derived catalog facts (Prompt 3b, decisions E15–E23 in docs/ONBOARDING_PLAN.md).
 * Foods carry the tags (data/foods.ts); recipes never do – their allergens,
 * animal kinds and diet are always derived from the ingredients here, so a
 * recipe cannot contradict what it is made of.
 */

/** The four diets (DietType includes pescatarian since Prompt 4). */
export type Diet = DietType;

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

// ---------- Hard exclusions (Prompt 4: the one filter for plan, suggestions and shopping) ----------

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
  /** Catalog foods excluded via the free text. */
  foods?: string[];
  /** Free text without a catalog match – checked against the names of own products. */
  texts?: string[];
}

/** Is the food excluded? Catalog foods by their tags, own products by what is known about them. */
export function isExcluded(food: Food, ex: HardExclusions): boolean {
  if (ex.foods?.includes(food.id)) return true;
  const t = food.tags;
  if (!t) return ownFoodExcluded(food, ex);
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

/** The four old product flags read as LMIV allergens – the stricter reading (milk for "lactose"). */
const LEGACY_AS_LMIV: Record<Allergen, LmivAllergen[]> = { lactose: ['milk'], gluten: ['gluten'], nuts: ['peanuts', 'tree_nuts'], fish: ['fish'] };

/**
 * Own products and dish ingredients: only KNOWN facts exclude – declared
 * allergens and traces, a stated diet, the name against the free text.
 * What is unknown stays the user's own choice; nothing is guessed.
 */
function ownFoodExcluded(food: Food, ex: HardExclusions): boolean {
  const name = normalize(food.name);
  if (ex.texts?.some((text) => name.includes(normalize(text)))) return true;
  const declared = new Set([...(food.declared?.allergens ?? []), ...food.allergens.flatMap((a) => LEGACY_AS_LMIV[a])]);
  const traces = new Set(food.declared?.traces ?? []);
  const allergens = ex.allergens ?? [];
  if (allergens.some((a) => declared.has(a) || (traces.has(a) && !ex.tracesOk?.includes(a)))) return true;
  const intol = ex.intolerances ?? [];
  if (intol.includes('lactose') && declared.has('milk')) return true; // lactose-free is not known for an own product
  if (intol.includes('celiac') && (declared.has('gluten') || traces.has('gluten'))) return true;
  const knownNotVegan = !food.vegan && !food.dietUnknown?.vegan;
  const knownNotVegetarian = !food.vegetarian && !food.dietUnknown?.vegetarian;
  if (ex.diet === 'vegan' && knownNotVegan) return true;
  // "Not vegetarian" may be meat or fish – for pescatarians the stricter reading wins.
  if ((ex.diet === 'vegetarian' || ex.diet === 'pescatarian') && knownNotVegetarian) return true;
  return false;
}

const exclusionsCache = new WeakMap<NutritionProfile, HardExclusions>();

/**
 * The hard exclusions of a profile: the new fields (Prompt 4) merged with
 * the old `excluded` – "Nüsse" counts as peanuts AND tree nuts, "Laktose" as
 * the intolerance (E5). Cached per profile object (the planner asks often).
 */
export function hardExclusionsOf(profile: NutritionProfile | null): HardExclusions {
  if (!profile) return {};
  const cached = exclusionsCache.get(profile);
  if (cached) return cached;
  const allergens = new Set<LmivAllergen>(profile.allergens ?? []);
  const intolerances = new Set<Intolerance>(profile.intolerances ?? []);
  for (const a of profile.excluded ?? []) {
    if (a === 'lactose') intolerances.add('lactose');
    else LEGACY_AS_LMIV[a].forEach((x) => allergens.add(x));
  }
  const ex: HardExclusions = {
    diet: profile.diet,
    allergens: [...allergens],
    ...(profile.tracesOk?.length ? { tracesOk: [...profile.tracesOk] } : {}),
    intolerances: [...intolerances],
    ...(profile.noPork ? { pork: true } : {}),
    ...(profile.noAlcohol ? { alcohol: true } : {}),
    ...(profile.fermentationAlcoholOk ? { fermentationAlcoholOk: true } : {}),
    ...(profile.excludedFoods?.length ? { foods: [...profile.excludedFoods] } : {}),
    ...(profile.excludedText?.length ? { texts: [...profile.excludedText] } : {}),
  };
  exclusionsCache.set(profile, ex);
  return ex;
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
  const swapped = substituteFood(foodId, swapContextOf(ex));
  const variant = swapped !== foodId ? getFood(swapped) : undefined;
  return variant && !isExcluded(variant, ex) ? swapped : undefined;
}

/** A recipe is allowed when every ingredient is usable – possibly as its lactose-free variant. */
export function recipeAllowedBy(recipe: Recipe, ex: HardExclusions): boolean {
  return recipe.ingredients.every((ing) => usableFood(ing.foodId, ex) !== undefined);
}

export function swapContextOf(ex: HardExclusions) {
  return { lactoseIntolerant: !!ex.intolerances?.includes('lactose'), milkAllergy: !!ex.allergens?.includes('milk') };
}

// ---------- Free text against the catalog ----------

/** Lower case, umlauts folded, no punctuation – "Süßkartoffeln" ~ "suesskartoffeln". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * "Was isst du sonst nicht?" – each entry is matched against the catalog
 * names (at least 3 letters). Matches become hard exclusions, the rest stays
 * as text and is checked against the names of own products.
 */
export function matchCatalog(entries: string[], foods: Food[]): { foods: string[]; unmatched: string[] } {
  const ids = new Set<string>();
  const unmatched: string[] = [];
  for (const raw of entries) {
    const term = normalize(raw);
    const hits = term.length >= 3 ? foods.filter((f) => normalize(f.name).includes(term)) : [];
    if (hits.length) hits.forEach((f) => ids.add(f.id));
    else if (raw.trim()) unmatched.push(raw.trim());
  }
  return { foods: [...ids], unmatched };
}

// ---------- Feasibility (Prompt 4, threshold in constants) ----------

export interface Feasibility {
  /** Allowed recipes per selected slot. */
  counts: Partial<Record<MealSlot, number>>;
  ok: boolean;
  /** The slot with the fewest recipes. */
  weakest?: MealSlot;
  /** The single change that helps most – a suggestion, never applied silently. */
  suggestion?: FeasibilitySuggestion;
}

export type FeasibilityChange = { kind: 'traces'; allergen: LmivAllergen } | { kind: 'fermentation' } | { kind: 'food'; foodId: string } | { kind: 'diet'; diet: Diet };
export interface FeasibilitySuggestion {
  label: string;
  change: FeasibilityChange;
  ex: HardExclusions;
  /** Allowed recipes per slot after the change. */
  counts: Partial<Record<MealSlot, number>>;
}

const LOOSER_DIET: Partial<Record<Diet, Diet>> = { vegan: 'vegetarian', vegetarian: 'pescatarian', pescatarian: 'omnivore' };
const DIET_NAME: Record<Diet, string> = { omnivore: 'alles', pescatarian: 'pescetarisch', vegetarian: 'vegetarisch', vegan: 'vegan' };

function countBySlot(ex: HardExclusions, slots: MealSlot[], recipes: Recipe[]): Partial<Record<MealSlot, number>> {
  // "Snack 2" uses the snack recipes (planner.recipeSlot).
  return Object.fromEntries(slots.map((slot) => [slot, recipes.filter((r) => r.slots.includes(slot === 'snack2' ? 'snack' : slot) && recipeAllowedBy(r, ex)).length]));
}

/**
 * Are there enough recipes per meal after the exclusions? If not, the
 * onboarding shows a hint with ONE suggestion (the relaxation that raises the
 * weakest meal the most) instead of producing an empty plan later.
 */
export function feasibility(ex: HardExclusions, slots: MealSlot[], recipes: Recipe[], minPerSlot: number): Feasibility {
  const counts = countBySlot(ex, slots, recipes);
  const min = (c: Partial<Record<MealSlot, number>>) => Math.min(...slots.map((s) => c[s] ?? 0));
  const weakest = slots.reduce<MealSlot | undefined>((w, s) => (w === undefined || (counts[s] ?? 0) < (counts[w] ?? 0) ? s : w), undefined);
  if (!slots.length || min(counts) >= minPerSlot) return { counts, ok: true, ...(weakest ? { weakest } : {}) };

  const options: Omit<FeasibilitySuggestion, 'counts'>[] = [];
  for (const a of ex.allergens ?? []) {
    if (!ex.tracesOk?.includes(a)) options.push({ label: `Spuren von ${ALLERGEN_LABEL[a]} erlauben`, change: { kind: 'traces', allergen: a }, ex: { ...ex, tracesOk: [...(ex.tracesOk ?? []), a] } });
  }
  if (ex.alcohol && !ex.fermentationAlcoholOk) options.push({ label: 'Alkohol aus Fermentation (z. B. Sojasauce) erlauben', change: { kind: 'fermentation' }, ex: { ...ex, fermentationAlcoholOk: true } });
  for (const id of ex.foods ?? []) options.push({ label: `${getFood(id)?.name ?? id} wieder erlauben`, change: { kind: 'food', foodId: id }, ex: { ...ex, foods: ex.foods!.filter((f) => f !== id) } });
  const looser = ex.diet ? LOOSER_DIET[ex.diet] : undefined;
  if (looser) options.push({ label: `Ernährungsform „${DIET_NAME[looser]}“ statt „${DIET_NAME[ex.diet!]}“`, change: { kind: 'diet', diet: looser }, ex: { ...ex, diet: looser } });

  let best: (FeasibilitySuggestion & { score: number }) | undefined;
  for (const o of options) {
    const c = countBySlot(o.ex, slots, recipes);
    const score = min(c) * 1000 + slots.reduce((sum, s) => sum + (c[s] ?? 0), 0);
    if (min(c) > min(counts) && (!best || score > best.score)) best = { ...o, counts: c, score };
  }
  return { counts, ok: false, ...(weakest ? { weakest } : {}), ...(best ? { suggestion: { label: best.label, change: best.change, ex: best.ex, counts: best.counts } } : {}) };
}

/** German names of the 14 LMIV allergens, as the chips show them. */
export const ALLERGEN_LABEL: Record<LmivAllergen, string> = {
  gluten: 'glutenhaltigem Getreide',
  crustaceans: 'Krebstieren',
  eggs: 'Eiern',
  fish: 'Fisch',
  peanuts: 'Erdnüssen',
  soy: 'Soja',
  milk: 'Milch',
  tree_nuts: 'Schalenfrüchten',
  celery: 'Sellerie',
  mustard: 'Senf',
  sesame: 'Sesam',
  sulphites: 'Sulfiten',
  lupin: 'Lupinen',
  molluscs: 'Weichtieren',
};

// ---------- Display ----------

/** Chips of a recipe: the typed facts first ("Meal Prep", "To go"), then the free tags. */
export function recipeLabels(recipe: Recipe): string[] {
  const typed: string[] = [];
  if (recipe.mealPrep) typed.push('Meal Prep');
  if (recipe.portable === 'yes') typed.push('To go');
  if (recipe.portable === 'chilled') typed.push('To go · Kühlung nötig');
  return [...typed, ...recipe.tags];
}
