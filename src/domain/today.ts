import { addDays, weekDays, weekStart } from './dates';
import { SLOT_ORDER } from './planner';
import { activeWorkouts, type PlannedWorkout } from './training';
import type { AppState, ISODate, MealSlot, PlannedMeal } from './types';
import { weekShopping } from './week';

/**
 * F-"Heute": exactly ONE next action for the day – derived from the plan, never
 * a recommendation. Order:
 *   running workout → no plan yet → meal that is due → today's training →
 *   shopping needed today/tomorrow → next meal later today → done.
 */
export type NextAction =
  | { kind: 'resume_workout'; workoutId: string; name: string }
  | { kind: 'plan_week'; week: ISODate }
  | { kind: 'log_meal'; meal: PlannedMeal; due: boolean }
  | { kind: 'start_training'; session: PlannedWorkout }
  | { kind: 'shopping'; count: number }
  | { kind: 'done' };

/** A meal counts as due from this hour on. */
export const SLOT_DUE_HOUR: Record<MealSlot, number> = { breakfast: 6, snack: 10, lunch: 11, dinner: 17 };

export function nextAction(state: AppState, date: ISODate, hour: number): NextAction {
  const running = state.workouts.find((w) => w.status === 'in_progress');
  if (running) return { kind: 'resume_workout', workoutId: running.id, name: running.name };

  const ws = weekStart(date);
  const end = addDays(ws, 6);
  const planned = state.plannedMeals.filter((m) => m.date >= date && m.date <= end && m.status !== 'skipped');
  if (planned.length === 0) return { kind: 'plan_week', week: ws };

  const openToday = state.plannedMeals
    .filter((m) => m.date === date && m.status === 'planned')
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const due = openToday.find((m) => hour >= SLOT_DUE_HOUR[m.slot]);
  if (due) return { kind: 'log_meal', meal: due, due: true };

  const session = activeWorkouts(state.training, state.workoutOverrides, state.workouts, ws, state.dayContexts).find(
    (w) => w.date === date && !w.completedWorkoutId,
  );
  if (session) return { kind: 'start_training', session };

  const tomorrow = addDays(date, 1);
  const urgent = weekShopping(state, ws, date).filter((i) => i.state === 'open' && i.sources.some((s) => s.date <= tomorrow)).length;
  if (urgent > 0) return { kind: 'shopping', count: urgent };

  const later = openToday[0];
  if (later) return { kind: 'log_meal', meal: later, due: false };

  return { kind: 'done' };
}

/** True if the week containing `date` has nothing planned from `date` on. */
export function weekIsEmpty(state: AppState, date: ISODate): boolean {
  const days = weekDays(weekStart(date)).filter((d) => d >= date);
  return !state.plannedMeals.some((m) => days.includes(m.date) && m.status !== 'skipped');
}
