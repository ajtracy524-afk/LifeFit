import { addDays, weekDays } from './dates';
import { dayGoals } from './dayGoals';
import { dayTotals } from './nutrition';
import { appStartDate, weekTrainings } from './progress';
import { activeWorkouts } from './training';
import type { AppState, ISODate } from './types';
import { relativeDay } from '../lib/format';
import { waterOn } from './water';

/**
 * The week as one story: what was done, what is next, what improved – only
 * from real data, in plain counts ("Protein an 4 von 5 Tagen"). No streak
 * pressure, no "verpasst": days without data are simply not counted.
 */
export interface WeekProgress {
  /** Days of this week from the app start up to today. */
  days: number;
  trainings: { done: number; planned: number };
  /** Days with at least one food entry ("erfasst an X von Y Tagen"). */
  logged: number;
  /** Goal reached on this many of `days` – undefined when there is no goal / no data. */
  protein?: number;
  calories?: number;
  water?: number;
  /** Next open session of this week: "Fr · Beine – Kniebeuge & Hüfte". */
  next?: string;
  improvements: string[];
}

const MIN_DAYS_FOR_COMPARE = 3;

export function weekProgress(state: AppState, week: ISODate, today: ISODate): WeekProgress {
  const start = appStartDate(state);
  const days = weekDays(week).filter((d) => d <= today && d >= start);
  const goals = days.map((d) => dayGoals(state, d).goals);
  const count = (key: 'protein' | 'calories' | 'water') => {
    const withGoal = goals.filter((g) => g.some((x) => x.key === key));
    // A day counts once something was logged (protein / calories) – an empty day is no "miss".
    // A day counts once something was logged for it: food for protein / calories, a water entry for water.
    const logged = withGoal.filter((_, i) => (key === 'water' ? waterOn(state, days[i]!) > 0 : dayTotals(state.logEntries, days[i]!).kcal > 0));
    return logged.length ? logged.filter((g) => g.find((x) => x.key === key)!.done).length : undefined;
  };
  const sessions = activeWorkouts(state.training, state.workoutOverrides, state.workouts, week, state.dayContexts).filter((s) => s.originalDate >= start || s.date >= start);
  const next = sessions.find((s) => !s.completedWorkoutId && s.date >= today);

  const improvements: string[] = [];
  const weekWorkouts = state.workouts.filter((w) => w.status === 'completed' && w.date >= week && w.date <= addDays(week, 6));
  const records = weekWorkouts.reduce((n, w) => n + (w.records?.length ?? 0), 0);
  if (records) improvements.push(`🏆 ${records} ${records === 1 ? 'neue Bestleistung' : 'neue Bestleistungen'}`);
  const avgProtein = (from: ISODate, list: ISODate[]) => {
    const t = list.filter((d) => d >= from).map((d) => dayTotals(state.logEntries, d)).filter((m) => m.kcal > 0);
    return t.length >= MIN_DAYS_FOR_COMPARE ? t.reduce((s, m) => s + m.protein, 0) / t.length : undefined;
  };
  const now = avgProtein(start, days);
  const before = avgProtein(start, weekDays(addDays(week, -7)));
  if (now !== undefined && before !== undefined && now - before >= 5) improvements.push(`💪 Ø ${Math.round(now - before)} g Protein mehr pro Tag als letzte Woche`);

  return {
    days: days.length,
    trainings: weekTrainings(state, week),
    logged: days.filter((d) => state.logEntries.some((e) => e.date === d)).length,
    ...(count('protein') !== undefined ? { protein: count('protein') } : {}),
    ...(count('calories') !== undefined ? { calories: count('calories') } : {}),
    ...(count('water') !== undefined ? { water: count('water') } : {}),
    ...(next ? { next: `${relativeDay(next.date)} · ${next.template.name}` } : {}),
    improvements,
  };
}
