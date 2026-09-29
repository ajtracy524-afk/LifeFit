import { addDays, weekStart } from './dates';
import { activeWorkouts, isCompletedOn } from './training';
import { calorieStatus } from './calorieStatus';
import { dayTotals } from './nutrition';
import type { AppState, ISODate, LogEntry } from './types';
import { dayTargetFor } from './week';
import { waterOn } from './water';

/**
 * The goals of a day, each from real data – shown on Heute as small chips
 * that close one by one; all closed = "Tag abgeschlossen".
 *
 * - Mahlzeiten: every planned meal of the day is handled (eaten, or replaced
 *   by something logged). Only when the day has a plan.
 * - Kalorien: inside the target zone (the one zone of calorieStatus).
 * - Protein: the day's protein target reached.
 * - Wasser: the user's own water goal reached. Only when a goal is set.
 * - Training: on a training day, the session is done. Rest days have no training goal.
 *
 * A goal without data behind it is not shown at all – never a fake "done".
 */
export type DayGoalKey = 'meals' | 'calories' | 'protein' | 'water' | 'training';

export interface DayGoal {
  key: DayGoalKey;
  icon: string;
  label: string;
  done: boolean;
  /** "2 / 3", "1.820 / 2.100 kcal" … */
  detail: string;
}

export interface DayGoals {
  goals: DayGoal[];
  done: number;
  /** All goals done (and at least two goals to speak of a finished day). */
  complete: boolean;
}

const int = (n: number) => Math.round(n).toLocaleString('de-CH');

export function dayGoals(state: AppState, date: ISODate): DayGoals {
  const goals: DayGoal[] = [];
  const meals = state.plannedMeals.filter((m) => m.date === date);
  const counted = meals.filter((m) => m.status !== 'skipped' || state.logEntries.some((e) => e.replacedMealId === m.id));
  if (counted.length) {
    const handled = counted.filter((m) => m.status !== 'planned').length;
    goals.push({ key: 'meals', icon: '🍽️', label: 'Mahlzeiten', done: handled === counted.length, detail: `${handled} / ${counted.length}` });
  }
  const target = dayTargetFor(state, date);
  const eaten = dayTotals(state.logEntries, date);
  if (target) {
    const inZone = calorieStatus({ eaten: eaten.kcal, planned: 0, targetKcal: target.kcal, finished: false })?.key === 'in_zone';
    goals.push({ key: 'calories', icon: '🎯', label: 'Kalorien', done: inZone, detail: `${int(eaten.kcal)} / ${int(target.kcal)} kcal` });
    goals.push({ key: 'protein', icon: '💪', label: 'Protein', done: eaten.protein >= target.protein, detail: `${int(eaten.protein)} / ${int(target.protein)} g` });
  }
  const waterGoal = state.nutritionProfile?.waterGoalMl;
  if (waterGoal) {
    const ml = waterOn(state, date);
    goals.push({ key: 'water', icon: '💧', label: 'Wasser', done: ml >= waterGoal, detail: `${(ml / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} / ${(waterGoal / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} L` });
  }
  // Training belongs to the day like the meals: a planned (or already done) session is a goal of that day.
  const trained = isCompletedOn(state.workouts, date);
  const session = activeWorkouts(state.training, state.workoutOverrides, state.workouts, weekStart(date), state.dayContexts).find((s) => s.date === date);
  if (trained || session) goals.push({ key: 'training', icon: '🏋️', label: 'Training', done: !!trained, detail: trained ? `${trained.name} ✓` : session!.template.name });
  const done = goals.filter((g) => g.done).length;
  return { goals, done, complete: goals.length >= 2 && done === goals.length };
}

/**
 * Days in a row with at least one logged entry ("dabei") – back from
 * yesterday, plus today once something is logged today. A day without an
 * entry simply ends the count; there is no "lost" message anywhere.
 */
export function loggingStreak(entries: Pick<LogEntry, 'date'>[], today: ISODate): number {
  const days = new Set(entries.map((e) => e.date));
  let n = days.has(today) ? 1 : 0;
  for (let d = addDays(today, -1), i = 0; i < 366 && days.has(d); d = addDays(d, -1), i++) n++;
  return n;
}

/** A consistency count is only worth showing from this many days on. */
export const STREAK_MIN_DAYS = 2;
