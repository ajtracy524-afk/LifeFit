import { FOODS } from '../../data/foods';
import { matchCatalog } from '../catalogTags';
import { HOUSEHOLD } from '../constants';
import { SLOT_ORDER } from '../planner';
import type { MealSlot, NutritionProfile, PlannerSettings } from '../types';
import type { OnboardingProfile } from './types';

/**
 * Area B answers → the values the app computes with (docs/ONBOARDING_PLAN.md,
 * "eine Quelle der Wahrheit"): the onboarding keeps the answers, these pure
 * functions write them into the nutrition profile and the planner settings.
 * Only answered fields change anything; the rest stays as it is.
 */

type FoodAnswers = OnboardingProfile['food'];

export function nutritionProfileFrom(food: FoodAnswers, base: NutritionProfile): NutritionProfile {
  const np: NutritionProfile = { ...base };
  if (food.diet) np.diet = food.diet.value;
  // Once allergens or intolerances are answered, the new fields are the truth –
  // the old list (already migrated into the answers, E5) is retired.
  if (food.allergens || food.intolerances) np.excluded = [];
  if (food.allergens) np.allergens = [...food.allergens.value];
  if (food.intolerances) np.intolerances = [...food.intolerances.value];
  if (food.tracesOk) setList(np, 'tracesOk', food.tracesOk.value.filter((a) => np.allergens?.includes(a)));
  if (food.exclusions) {
    setFlag(np, 'noPork', food.exclusions.value.includes('pork'));
    setFlag(np, 'noAlcohol', food.exclusions.value.includes('alcohol'));
  }
  if (food.fermentationAlcoholOk) setFlag(np, 'fermentationAlcoholOk', food.fermentationAlcoholOk.value);
  if (food.customExclusions) {
    const { foods, unmatched } = matchCatalog(food.customExclusions.value, FOODS);
    setList(np, 'excludedFoods', foods);
    setList(np, 'excludedText', unmatched);
  }
  if (food.preferences) {
    const entries = Object.entries(food.preferences.value);
    setList(np, 'likedFoods', entries.filter(([, v]) => v === 'like').map(([id]) => id));
    setList(np, 'dislikedFoods', entries.filter(([, v]) => v === 'dislike').map(([id]) => id));
  }
  if (food.meals?.value.length) np.slots = orderedSlots(food.meals.value);
  return np;
}

export function plannerSettingsFrom(food: FoodAnswers, base: PlannerSettings): PlannerSettings {
  const ps: PlannerSettings = { ...base };
  if (food.cookingTime) ps.cookingTime = { ...food.cookingTime.value };
  if (food.householdSize) ps.householdSize = clampHousehold(food.householdSize.value);
  if (food.budget) {
    // "günstig" plans with the save priority; "mittel" / "egal" leave another chosen priority alone.
    if (food.budget.value === 'low') ps.priority = 'save';
    else if (ps.priority === 'save') ps.priority = 'balanced';
  }
  return ps;
}

/** Meals in the order of the day, without duplicates. */
export function orderedSlots(slots: MealSlot[]): MealSlot[] {
  return SLOT_ORDER.filter((s) => slots.includes(s));
}

export function clampHousehold(n: number): number {
  return Math.min(HOUSEHOLD.max, Math.max(HOUSEHOLD.min, Math.round(n)));
}

function setList<K extends 'tracesOk' | 'excludedFoods' | 'excludedText' | 'likedFoods' | 'dislikedFoods'>(np: NutritionProfile, key: K, list: NonNullable<NutritionProfile[K]>) {
  if (list.length) np[key] = list;
  else delete np[key];
}

function setFlag(np: NutritionProfile, key: 'noPork' | 'noAlcohol' | 'fermentationAlcoholOk', on: boolean) {
  if (on) np[key] = true;
  else delete np[key];
}
