import { addDays, daysBetween, toISODate, today, weekDays } from './dates';
import { dayTotals, targetForDate } from './nutrition';
import { activeWorkouts, workoutVolume } from './training';
import type { AppState, FitnessGoal, ISODate, WeightEntry } from './types';

/** First day the user used the app – days before don't count as "missed". */
export function appStartDate(state: Pick<AppState, 'profile'>): ISODate {
  return state.profile ? toISODate(new Date(state.profile.createdAt)) : today();
}

/** Trailing 7-day average per entry – smooths out daily water fluctuations. */
export function withTrend(weights: WeightEntry[]): (WeightEntry & { trend: number })[] {
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((w) => {
    const window = sorted.filter((o) => o.date <= w.date && daysBetween(o.date, w.date) < 7);
    const trend = window.reduce((s, o) => s + o.kg, 0) / window.length;
    return { ...w, trend };
  });
}

export function currentWeight(weights: WeightEntry[]): number | undefined {
  const t = withTrend(weights);
  return t.length ? t[t.length - 1]!.trend : undefined;
}

export function latestWeight(weights: WeightEntry[]): WeightEntry | undefined {
  return [...weights].sort((a, b) => b.date.localeCompare(a.date))[0];
}

/** Weight change per week from the trend over the last ~3 weeks. */
export function weeklyRate(weights: WeightEntry[]): number | undefined {
  const t = withTrend(weights);
  if (t.length < 2) return undefined;
  const last = t[t.length - 1]!;
  const ref = [...t].reverse().find((w) => daysBetween(w.date, last.date) >= 14) ?? t[0]!;
  const days = daysBetween(ref.date, last.date);
  if (days < 5) return undefined;
  return ((last.trend - ref.trend) / days) * 7;
}

export interface GoalProgress {
  percent: number;
  start: number;
  current: number;
  target?: number;
  remaining?: number;
  etaWeeks?: number;
}

export function goalProgress(goal: FitnessGoal, weights: WeightEntry[]): GoalProgress {
  const current = currentWeight(weights) ?? goal.startWeightKg;
  const start = goal.startWeightKg;
  const target = goal.targetWeightKg;
  if (target === undefined || target === start) {
    return { percent: 0, start, current, target };
  }
  const percent = Math.round(Math.min(100, Math.max(0, ((current - start) / (target - start)) * 100)));
  const remaining = target - current;
  const rate = weeklyRate(weights);
  const etaWeeks = rate && Math.sign(rate) === Math.sign(remaining) && Math.abs(rate) > 0.02 ? Math.ceil(remaining / rate) : undefined;
  return { percent, start, current, target, remaining, etaWeeks };
}

export interface WeekStats {
  loggedDays: number;
  avgKcal: number;
  avgProtein: number;
  targetKcal: number;
  targetProtein: number;
  /** Planned meals eaten as planned, of those due so far. */
  adherence?: number;
  workoutsDone: number;
  workoutsPlanned: number;
  volumeKg: number;
  records: number;
}

export function weekStats(state: AppState, weekStartDate: ISODate): WeekStats {
  const days = weekDays(weekStartDate);
  const end = days[6]!;
  const t = today();
  const pastDays = days.filter((d) => d <= t);

  const totals = pastDays.map((d) => dayTotals(state.logEntries, d)).filter((m) => m.kcal > 0);
  const avg = (key: 'kcal' | 'protein') => (totals.length ? totals.reduce((s, m) => s + m[key], 0) / totals.length : 0);
  const target = targetForDate(state.targets, pastDays[pastDays.length - 1] ?? weekStartDate);

  // Only meals of days that are over (plus today's eaten) count towards adherence.
  const due = state.plannedMeals.filter((m) => m.date >= weekStartDate && m.date <= end && (m.date < t || m.status === 'eaten'));
  const adherence = due.length ? Math.round((due.filter((m) => m.status === 'eaten').length / due.length) * 100) : undefined;

  const weekWorkouts = state.workouts.filter((w) => w.status === 'completed' && w.date >= weekStartDate && w.date <= end);
  const startDate = appStartDate(state);
  const schedule = activeWorkouts(state.training, state.workoutOverrides, state.workouts, weekStartDate).filter((s) => s.date >= startDate);

  return {
    loggedDays: totals.length,
    avgKcal: avg('kcal'),
    avgProtein: avg('protein'),
    targetKcal: target?.kcal ?? 0,
    targetProtein: target?.protein ?? 0,
    adherence,
    workoutsDone: weekWorkouts.length,
    workoutsPlanned: schedule.length,
    volumeKg: weekWorkouts.reduce((s, w) => s + (w.volumeKg ?? workoutVolume(w)), 0),
    records: weekWorkouts.reduce((s, w) => s + (w.records?.length ?? 0), 0),
  };
}

export function weightsInRange(weights: WeightEntry[], days: number | 'all'): ReturnType<typeof withTrend> {
  const all = withTrend(weights);
  if (days === 'all') return all;
  const from = addDays(today(), -days);
  return all.filter((w) => w.date >= from);
}
