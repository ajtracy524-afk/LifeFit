import { fmt } from '../lib/format';
import { weekStart } from './dates';
import { activeWorkouts, estimateMinutes, isCompletedOn } from './training';
import { calorieStatus } from './calorieStatus';
import { dayTotals } from './nutrition';
import type { AppState, ISODate } from './types';
import { dayTargetFor } from './week';
import { formatLitres, waterGoalReached, waterOn } from './water';

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
  /** Short value for the chip on Heute: "1.820 / 2.100", "1,8 / 2,5 L", "~52 min". */
  value: string;
}

export interface DayGoals {
  goals: DayGoal[];
  done: number;
  /** All goals done (and at least two goals to speak of a finished day). */
  complete: boolean;
}

// Same number format as the ring and every other value on Heute ("2.650").
const int = fmt.int;

export function dayGoals(state: AppState, date: ISODate): DayGoals {
  const goals: DayGoal[] = [];
  const meals = state.plannedMeals.filter((m) => m.date === date);
  // The status of the day first (kcal, protein, water, training) – the meal count last.
  let mealsGoal: DayGoal | undefined;
  const counted = meals.filter((m) => m.status !== 'skipped' || state.logEntries.some((e) => e.replacedMealId === m.id));
  if (counted.length) {
    const handled = counted.filter((m) => m.status !== 'planned').length;
    mealsGoal = ({ key: 'meals', icon: '🍽️', label: 'Mahlzeiten', done: handled === counted.length, detail: `${handled} / ${counted.length}`, value: `${handled} / ${counted.length}` });
  }
  const target = dayTargetFor(state, date);
  const eaten = dayTotals(state.logEntries, date);
  if (target) {
    const inZone = calorieStatus({ eaten: eaten.kcal, planned: 0, targetKcal: target.kcal, finished: false })?.key === 'in_zone';
    goals.push({ key: 'calories', icon: '🎯', label: 'Kalorien', done: inZone, detail: `${int(eaten.kcal)} / ${int(target.kcal)} kcal`, value: `${int(eaten.kcal)} / ${int(target.kcal)}` });
    // An entry without protein value makes the sum a lower bound: reaching the target is still real, the number is "mind.".
    const partial = state.logEntries.some((e) => e.date === date && e.unknown?.includes('protein'));
    goals.push({ key: 'protein', icon: '💪', label: 'Protein', done: eaten.protein >= target.protein, detail: `${partial ? 'mind. ' : ''}${int(eaten.protein)} / ${int(target.protein)} g`, value: `${partial ? '≥' : ''}${int(eaten.protein)} / ${int(target.protein)} g` });
  }
  const waterGoal = state.nutritionProfile?.waterGoalMl;
  if (waterGoal) {
    const ml = waterOn(state, date);
    const litres = (v: number) => (v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 });
    goals.push({ key: 'water', icon: '💧', label: 'Wasser', done: !!waterGoalReached(state, date), detail: `${formatLitres(ml)} von ${formatLitres(waterGoal)}`, value: `${litres(ml)} / ${formatLitres(waterGoal)}` });
  }
  // Training belongs to the day like the meals: a planned (or already done) session is a goal of that day.
  const trained = isCompletedOn(state.workouts, date);
  const session = activeWorkouts(state.training, state.workoutOverrides, state.workouts, weekStart(date), state.dayContexts).find((s) => s.date === date);
  if (trained || session) goals.push({ key: 'training', icon: '🏋️', label: 'Training', done: !!trained, detail: trained ? `${trained.name} ✓` : session!.template.name, value: trained ? 'erledigt' : `~${estimateMinutes(session!.template)} min` });
  if (mealsGoal) goals.push(mealsGoal);
  const done = goals.filter((g) => g.done).length;
  return { goals, done, complete: goals.length >= 2 && done === goals.length };
}
