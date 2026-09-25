import { weekStart } from '../dates';
import { calorieFloor, targetForDate } from '../nutrition';
import { currentWeight } from '../progress';
import { activeWorkouts } from '../training';
import type { AppState, ISODate, Macros, NutritionTarget } from '../types';

/**
 * Training days get more energy, rest days correspondingly less – the WEEKLY
 * sum stays exactly the stored target × 7. Protein and fat stay constant,
 * the difference is carried by carbohydrates.
 */
export const TRAINING_DAY_KCAL = 150;

/** kcal shift of one day. 0 if the week has no or only training days. */
export function dayShift(isTrainingDay: boolean, trainingDays: number): number {
  if (trainingDays <= 0 || trainingDays >= 7) return 0;
  return isTrainingDay ? TRAINING_DAY_KCAL : -Math.round((TRAINING_DAY_KCAL * trainingDays) / (7 - trainingDays));
}

export function shiftTarget<T extends Macros>(base: T, deltaKcal: number): T {
  if (deltaKcal === 0) return base;
  return { ...base, kcal: base.kcal + deltaKcal, carbs: Math.max(0, Math.round(base.carbs + deltaKcal / 4)) };
}

/** Dates with a session that takes place (moved sessions count on their new day). */
export function trainingDates(state: Pick<AppState, 'training' | 'workoutOverrides' | 'workouts'>, weekStartDate: ISODate): Set<ISODate> {
  return new Set(activeWorkouts(state.training, state.workoutOverrides, state.workouts, weekStartDate).map((w) => w.date));
}

/**
 * The target that applies to one concrete day. Every screen and the planner
 * use this – never the raw stored target – so all views agree.
 */
export function dayTargetFor(state: AppState, date: ISODate): NutritionTarget | undefined {
  const base = targetForDate(state.targets, date);
  if (!base) return undefined;
  const dates = trainingDates(state, weekStart(date));
  let delta = dayShift(dates.has(date), dates.size);

  // Rest days never drop below the safety floor.
  if (delta < 0 && state.profile) {
    const weight = currentWeight(state.weights) ?? state.goal?.startWeightKg;
    if (weight) delta = Math.max(delta, Math.min(0, Math.ceil(calorieFloor(state.profile, weight) - base.kcal)));
  }
  return shiftTarget(base, delta);
}
