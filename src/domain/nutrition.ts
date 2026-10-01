import { getFood } from '../data/foods';
import { isPersonalFoodId } from '../data/personal';
import { NUTRIENTS } from '../data/nutrients';
import { getRecipe } from '../data/recipes';
import { newId } from '../lib/id';
import { bmrFor, energyEstimate, type EnergyInput } from './body';
import type {
  BasicNutrient,
  Food,
  FitnessGoal,
  ISODate,
  LogEntry,
  Macros,
  MealSlot,
  MicroNutrient,
  Micros,
  NutritionProfile,
  NutritionTarget,
  PlannedMeal,
  Profile,
  Recipe,
} from './types';

/** All optional nutrients (order = display order). */
export const MICRO_NUTRIENTS = Object.keys(NUTRIENTS) as MicroNutrient[];
/** Fiber, sugar, salt – shown in the day's short line and in the manual form. */
export const BASIC_NUTRIENTS: BasicNutrient[] = ['fiber', 'sugar', 'salt'];
/** Vitamins and minerals – the optional "Mikronährstoffe" list. */
export const VITAL_NUTRIENTS = MICRO_NUTRIENTS.filter((k) => NUTRIENTS[k].group !== 'basic');

export const ZERO_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export function addMacros(a: Macros, b: Macros): Macros {
  return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat };
}

export function scaleMacros(m: Macros, factor: number): Macros {
  return { kcal: m.kcal * factor, protein: m.protein * factor, carbs: m.carbs * factor, fat: m.fat * factor };
}

export function sumMacros(list: Macros[]): Macros {
  return list.reduce(addMacros, ZERO_MACROS);
}

export function roundMacros(m: Macros): Macros {
  return {
    kcal: Math.round(m.kcal),
    protein: Math.round(m.protein * 10) / 10,
    carbs: Math.round(m.carbs * 10) / 10,
    fat: Math.round(m.fat * 10) / 10,
  };
}

export function foodMacros(food: Food, grams: number): Macros {
  return scaleMacros(food.per100, grams / 100);
}

/** Only the nutrients that are known, scaled and rounded to 0.1 g (salt to 0.01 g). */
export function scaleMicros(per100: Micros | undefined, factor: number): Micros {
  const out: Micros = {};
  for (const key of MICRO_NUTRIENTS) {
    const v = per100?.[key];
    if (v !== undefined && Number.isFinite(v)) out[key] = roundMicro(key, v * factor);
  }
  return out;
}

export { consistentMicros } from '../data/nutrients';

/** Salt to 0.01 g, small mg/µg values to 0.01, everything else to 0.1 – never rounds a real amount down to 0. */
export function roundMicro(key: MicroNutrient, v: number): number {
  const precision = key === 'salt' || (NUTRIENTS[key].unit !== 'g' && Math.abs(v) < 1) ? 100 : 10;
  return Math.round(v * precision) / precision;
}

/**
 * Salt and sodium are never summed for a recipe: the salt added while cooking
 * is not in the recipe data, so the ingredient sum would look lower than what
 * is really eaten.
 */
const RECIPE_SKIPS: ReadonlySet<MicroNutrient> = new Set(['salt', 'sodium']);

/**
 * Micronutrients of a recipe from the catalog data (FoodData Central). A
 * nutrient is known only if EVERY ingredient has a value for it – one gap
 * makes it unknown, never guessed or counted as 0.
 */
export function recipeMicros(recipe: Recipe, servings = 1): Micros {
  return sumCompleteMicros(
    recipe.ingredients.map((ing) => ({ micros100: getFood(ing.foodId)?.micros, grams: ing.grams * servings })),
    // Own dishes list every ingredient (salt included); catalog recipes leave out the unknown cooking salt.
    recipe.personal ? undefined : RECIPE_SKIPS,
  );
}

/**
 * THE rule for a sum of ingredients (recipes, own dishes): a nutrient is
 * known only if EVERY ingredient has a value for it – one gap makes it
 * unknown, never 0 and never the sum of the known part.
 */
export function sumCompleteMicros(items: { micros100?: Micros; grams: number }[], skip: ReadonlySet<MicroNutrient> = new Set()): Micros {
  const out: Micros = {};
  if (!items.length) return out;
  for (const key of MICRO_NUTRIENTS) {
    if (skip.has(key)) continue;
    let sum = 0;
    const known = items.every(({ micros100, grams }) => {
      const v = micros100?.[key];
      if (v !== undefined && Number.isFinite(v)) sum += (v * grams) / 100;
      return v !== undefined && Number.isFinite(v);
    });
    if (known) out[key] = roundMicro(key, sum);
  }
  return out;
}

export function recipeMacros(recipe: Recipe, servings = 1): Macros {
  const perServing = sumMacros(
    recipe.ingredients.map((ing) => {
      const food = getFood(ing.foodId);
      return food ? foodMacros(food, ing.grams) : ZERO_MACROS;
    }),
  );
  return scaleMacros(perServing, servings);
}

export function plannedMealMacros(meal: PlannedMeal): Macros {
  const recipe = getRecipe(meal.recipeId);
  return recipe ? recipeMacros(recipe, meal.servings) : ZERO_MACROS;
}

// ---------- Targets ----------

export interface TargetCalculation extends Macros {
  bmr: number;
  tdee: number;
}

export interface TargetOptions {
  /** Known body fat – decides the BMR formula (Katch-McArdle / mean, see body.ts). */
  bodyFat?: EnergyInput['bodyFat'];
  /** Length of a planned session (training surcharge); default in constants. */
  sessionMinutes?: number;
}

/**
 * Daily target: total energy (body.energyEstimate – BMR × everyday factor +
 * training surcharge, one calculation for the whole app, E10) adjusted for the
 * goal. Includes safety floors. Stored targets are snapshots: changing this
 * formula never rewrites an existing target version.
 */
export function calculateTargets(
  profile: Pick<Profile, 'sex' | 'age' | 'heightCm' | 'activity'>,
  goalType: FitnessGoal['type'],
  weightKg: number,
  trainingDaysPerWeek: number,
  options: TargetOptions = {},
): TargetCalculation {
  const energy = energyEstimate({ ...profile, weightKg, sessionsPerWeek: trainingDaysPerWeek, ...(options.bodyFat ? { bodyFat: options.bodyFat } : {}), ...(options.sessionMinutes ? { sessionMinutes: options.sessionMinutes } : {}) });
  const { bmr, tdee } = energy;

  // Recomposition: close to maintenance, slightly below – muscle is built from training and protein, fat is lost slowly.
  const goalFactor = goalType === 'muscle_gain' ? 1.1 : goalType === 'fat_loss' ? 0.8 : goalType === 'recomp' ? 0.95 : 1;
  const kcal = Math.round(Math.max(tdee * goalFactor, calorieFloor(profile, weightKg)) / 10) * 10;

  const proteinPerKg = goalType === 'maintain' ? 1.8 : 2;
  const protein = Math.round(Math.min(weightKg * proteinPerKg, 220));

  return { bmr: Math.round(bmr), tdee: Math.round(tdee), ...macrosForCalories(kcal, protein, weightKg) };
}

/** Mifflin-St Jeor (one formula, body.ts; "keine Angabe" −78, E2). */
export function basalMetabolicRate(profile: Pick<Profile, 'sex' | 'age' | 'heightCm'>, weightKg: number): number {
  return bmrFor({ ...profile, weightKg }).kcal;
}

/** Safety floor: no target (formula or adaptive) may go below this. "Keine Angabe" takes the more careful 1500 kcal (E2/E11). */
export function calorieFloor(profile: Pick<Profile, 'sex' | 'age' | 'heightCm'>, weightKg: number): number {
  return Math.max(basalMetabolicRate(profile, weightKg) * 1.1, profile.sex === 'female' ? 1200 : 1500);
}

/** Splits calories into macros: protein fixed, fat ≥ 25 % (and ≥ 0.8 g/kg), rest carbs. */
export function macrosForCalories(kcal: number, protein: number, weightKg: number): Macros {
  const fat = Math.round(Math.max((kcal * 0.25) / 9, weightKg * 0.8));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat };
}

/** The target valid on a given day (targets are versioned by `validFrom`). */
export function targetForDate(targets: NutritionTarget[], date: ISODate): NutritionTarget | undefined {
  let best: NutritionTarget | undefined;
  for (const t of targets) {
    if (t.validFrom <= date && (!best || t.validFrom > best.validFrom)) best = t;
  }
  // Days before the first target (e.g. earlier this week) use the first one.
  return best ?? [...targets].sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
}

// ---------- Diet filters ----------

/** Hard filter: diet, allergens and explicit dislikes. Nothing learned can override it. */
export function recipeAllowed(recipe: Recipe, profile: NutritionProfile | null): boolean {
  if (!profile) return true;
  return recipe.ingredients.every((ing) => {
    // Own products / ingredients of an own dish: KNOWN facts (declared allergens, stated diet) are hard exclusions;
    // what is unknown stays the user's own choice – nothing is guessed from a name.
    if (recipe.personal && isPersonalFoodId(ing.foodId)) {
      const own = getFood(ing.foodId);
      if (!own) return true;
      if (own.allergens.some((a) => profile.excluded.includes(a))) return false;
      if (profile.diet === 'vegan' && !own.vegan && !own.dietUnknown?.vegan) return false;
      if (profile.diet === 'vegetarian' && !own.vegetarian && !own.dietUnknown?.vegetarian) return false;
      return true;
    }
    const food = getFood(ing.foodId);
    return !!food && foodAllowed(food, profile);
  });
}

export function foodAllowed(food: Food, profile: NutritionProfile | null): boolean {
  if (!profile) return true;
  if (profile.diet === 'vegan' && !food.vegan) return false;
  if (profile.diet === 'vegetarian' && !food.vegetarian) return false;
  if (profile.dislikedFoods?.includes(food.id)) return false;
  return !food.allergens.some((a) => profile.excluded.includes(a));
}

/** Log entry for an eaten planned meal – with a nutrient snapshot, so history survives catalog changes. */
export function logFromMeal(meal: PlannedMeal, loggedAt: string = new Date().toISOString()): LogEntry {
  const recipe = getRecipe(meal.recipeId);
  return {
    id: newId(),
    date: meal.date,
    slot: meal.slot,
    loggedAt,
    name: recipe?.title ?? 'Mahlzeit',
    plannedMealId: meal.id,
    recipeId: meal.recipeId,
    servings: meal.servings,
    method: 'plan',
    macros: roundMacros(recipe ? recipeMacros(recipe, meal.servings) : ZERO_MACROS),
    ...(recipe ? { micros: recipeMicros(recipe, meal.servings) } : {}),
  };
}

// ---------- Daily totals ----------

export function dayTotals(entries: LogEntry[], date: ISODate): Macros {
  return sumMacros(entries.filter((e) => e.date === date).map((e) => e.macros));
}

/** An optional nutrient summed over entries: `known` of `of` entries had a value. */
export interface MicroTotal {
  value: number;
  known: number;
  of: number;
}

export interface NutritionSummary {
  macros: Macros;
  micros: Record<MicroNutrient, MicroTotal>;
  entries: number;
  /** Entries missing at least one macro (e.g. a product without protein data). */
  incomplete: number;
}

/**
 * Totals of log entries. Macros always add up (unknown ones count as 0 and are
 * flagged); optional nutrients report how many entries actually knew them, so
 * the UI never presents a partial sum as complete.
 */
export function summarizeEntries(entries: LogEntry[]): NutritionSummary {
  const micros = Object.fromEntries(MICRO_NUTRIENTS.map((k) => [k, { value: 0, known: 0, of: entries.length }])) as Record<MicroNutrient, MicroTotal>;
  for (const e of entries) {
    for (const key of MICRO_NUTRIENTS) {
      const v = e.micros?.[key];
      if (v !== undefined) {
        micros[key].value += v;
        micros[key].known++;
      }
    }
  }
  for (const key of MICRO_NUTRIENTS) micros[key].value = roundMicro(key, micros[key].value);
  return {
    macros: roundMacros(sumMacros(entries.map((e) => e.macros))),
    micros,
    entries: entries.length,
    incomplete: entries.filter((e) => e.unknown?.length).length,
  };
}

/** Summary of one day and of each of its meal slots. */
export function daySummary(entries: LogEntry[], date: ISODate): { day: NutritionSummary; slots: Record<MealSlot, NutritionSummary> } {
  const ofDay = entries.filter((e) => e.date === date);
  const slot = (s: MealSlot) => summarizeEntries(ofDay.filter((e) => e.slot === s));
  return { day: summarizeEntries(ofDay), slots: { breakfast: slot('breakfast'), snack: slot('snack'), lunch: slot('lunch'), dinner: slot('dinner') } };
}

/** Servings are rounded to 0.1 and kept in a sensible range. */
export function roundServings(s: number): number {
  return Math.min(3, Math.max(0.5, Math.round(s * 10) / 10));
}
