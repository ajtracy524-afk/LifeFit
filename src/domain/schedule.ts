import { learnedTrainingHour } from './learning';
import { SLOT_ORDER } from './planner';
import { activeWorkouts, type PlannedWorkout } from './training';
import type { AppState, ISODate, LogEntry, MealSlot, PlannedMeal } from './types';
import { weekStart } from './dates';

/**
 * Daily rhythm – practical planning, no nutrient-timing science: when are the
 * meals, when is training, which meal comes right before / after it.
 */

export const DEFAULT_TRAINING_TIME = '18:00';

export function minutesOf(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** Usual training time: set by the user, otherwise learned from completed workouts, otherwise 18:00. */
export function trainingTimeFor(state: AppState): { time: string; source: 'user' | 'learned' | 'default' } {
  if (state.plannerSettings?.trainingTime) return { time: state.plannerSettings.trainingTime, source: 'user' };
  const hour = learnedTrainingHour(state.learning?.preferences ?? {});
  if (hour !== undefined) return { time: `${String(hour).padStart(2, '0')}:00`, source: 'learned' };
  return { time: DEFAULT_TRAINING_TIME, source: 'default' };
}

export function sessionOn(state: AppState, date: ISODate): PlannedWorkout | undefined {
  return activeWorkouts(state.training, state.workoutOverrides, state.workouts, weekStart(date), state.dayContexts).find((w) => w.date === date);
}

/** First meal at least 60 min after training on a training day. */
export function postWorkoutSlot(state: AppState, date: ISODate): MealSlot | undefined {
  if (!sessionOn(state, date)) return undefined;
  const slots = state.nutritionProfile?.slots ?? SLOT_ORDER;
  const training = minutesOf(trainingTimeFor(state).time);
  return slots
    .map((slot) => ({ slot, at: minutesOf(state.plannerSettings.mealTimes[slot]) }))
    .filter((x) => x.at >= training + 60)
    .sort((a, b) => a.at - b.at)[0]?.slot;
}

/** A snack 30 min – 3 h before training. */
export function preWorkoutSlot(state: AppState, date: ISODate): MealSlot | undefined {
  if (!sessionOn(state, date)) return undefined;
  const slots = state.nutritionProfile?.slots ?? SLOT_ORDER;
  if (!slots.includes('snack')) return undefined;
  const gap = minutesOf(trainingTimeFor(state).time) - minutesOf(state.plannerSettings.mealTimes.snack);
  return gap >= 30 && gap <= 180 ? 'snack' : undefined;
}

export type TimelineItem =
  | { kind: 'meal'; time: string; meal: PlannedMeal; role?: 'pre' | 'post' }
  /** A planned meal the user replaced ("Ersetzen" with a product or manual entry) – shown in its place. */
  | { kind: 'replaced'; time: string; meal: PlannedMeal; entries: LogEntry[] }
  /** Skipped without a replacement (not eaten, or eaten out) – shown so the day stays readable, never counted. */
  | { kind: 'skipped'; time: string; meal: PlannedMeal }
  | { kind: 'training'; time: string; session: PlannedWorkout };

/** "Dein Plan" for a day: meals (or what replaced them) and training in time order. */
export function dayTimeline(state: AppState, date: ISODate): TimelineItem[] {
  const pre = preWorkoutSlot(state, date);
  const post = postWorkoutSlot(state, date);
  const items: TimelineItem[] = [];
  for (const meal of state.plannedMeals) {
    if (meal.date !== date) continue;
    const time = state.plannerSettings.mealTimes[meal.slot];
    if (meal.status !== 'skipped') {
      items.push({ kind: 'meal', time, meal, role: meal.slot === post ? 'post' : meal.slot === pre ? 'pre' : undefined });
      continue;
    }
    const entries = state.logEntries.filter((e) => e.replacedMealId === meal.id);
    items.push(entries.length ? { kind: 'replaced', time, meal, entries } : { kind: 'skipped', time, meal });
  }
  const session = sessionOn(state, date);
  if (session) items.push({ kind: 'training', time: trainingTimeFor(state).time, session });
  return items.sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
}
