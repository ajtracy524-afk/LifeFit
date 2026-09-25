import { getFood } from '../data/foods';
import { getRecipe } from '../data/recipes';
import { newId } from '../lib/id';
import type {
  ActivityLevel,
  Food,
  FitnessGoal,
  ISODate,
  LogEntry,
  Macros,
  NutritionProfile,
  NutritionTarget,
  PlannedMeal,
  Profile,
  Recipe,
} from './types';

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

/** Daily activity outside the gym. Training days are added on top. */
const ACTIVITY_BASE: Record<ActivityLevel, number> = {
  sedentary: 1.25,
  light: 1.35,
  moderate: 1.45,
  active: 1.6,
};

export interface TargetCalculation extends Macros {
  bmr: number;
  tdee: number;
}

/** Mifflin-St Jeor BMR × activity, adjusted for the goal. Includes safety floors. */
export function calculateTargets(
  profile: Pick<Profile, 'sex' | 'age' | 'heightCm' | 'activity'>,
  goalType: FitnessGoal['type'],
  weightKg: number,
  trainingDaysPerWeek: number,
): TargetCalculation {
  const bmr = basalMetabolicRate(profile, weightKg);
  const factor = ACTIVITY_BASE[profile.activity] + 0.04 * trainingDaysPerWeek;
  const tdee = bmr * factor;

  const goalFactor = goalType === 'muscle_gain' ? 1.1 : goalType === 'fat_loss' ? 0.8 : 1;
  const kcal = Math.round(Math.max(tdee * goalFactor, calorieFloor(profile, weightKg)) / 10) * 10;

  const proteinPerKg = goalType === 'maintain' ? 1.8 : 2;
  const protein = Math.round(Math.min(weightKg * proteinPerKg, 220));

  return { bmr: Math.round(bmr), tdee: Math.round(tdee), ...macrosForCalories(kcal, protein, weightKg) };
}

/** Mifflin-St Jeor. */
export function basalMetabolicRate(profile: Pick<Profile, 'sex' | 'age' | 'heightCm'>, weightKg: number): number {
  return 10 * weightKg + 6.25 * profile.heightCm - 5 * profile.age + (profile.sex === 'male' ? 5 : -161);
}

/** Safety floor: no target (formula or adaptive) may go below this. */
export function calorieFloor(profile: Pick<Profile, 'sex' | 'age' | 'heightCm'>, weightKg: number): number {
  return Math.max(basalMetabolicRate(profile, weightKg) * 1.1, profile.sex === 'male' ? 1500 : 1200);
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

export function recipeAllowed(recipe: Recipe, profile: NutritionProfile | null): boolean {
  if (!profile) return true;
  return recipe.ingredients.every((ing) => {
    const food = getFood(ing.foodId);
    if (!food) return false;
    if (profile.diet === 'vegan' && !food.vegan) return false;
    if (profile.diet === 'vegetarian' && !food.vegetarian) return false;
    return !food.allergens.some((a) => profile.excluded.includes(a));
  });
}

export function foodAllowed(food: Food, profile: NutritionProfile | null): boolean {
  if (!profile) return true;
  if (profile.diet === 'vegan' && !food.vegan) return false;
  if (profile.diet === 'vegetarian' && !food.vegetarian) return false;
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
  };
}

// ---------- Daily totals ----------

export function dayTotals(entries: LogEntry[], date: ISODate): Macros {
  return sumMacros(entries.filter((e) => e.date === date).map((e) => e.macros));
}

/** Servings are rounded to 0.1 and kept in a sensible range. */
export function roundServings(s: number): number {
  return Math.min(3, Math.max(0.5, Math.round(s * 10) / 10));
}
