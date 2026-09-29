import { getExercise } from '../data/exercises';
import { effortText } from './effort';
import { estimateOneRepMax, exerciseVolume, formatKg, formatSet, isWorkSet } from './training';
import type { ISODate, Workout, WorkoutExercise } from './types';

/**
 * Plan vs. reality and history – read only from what was stored. The plan of
 * an exercise is frozen at the start (`planned`), the sets are what really
 * happened; neither overwrites the other.
 */

export interface WorkoutStats {
  durationMin: number;
  exercises: number;
  sets: number;
  reps: number;
  volumeKg: number;
  records: number;
  cardioMin: number;
}

export function workoutStats(w: Workout): WorkoutStats {
  const end = new Date(w.endedAt ?? w.startedAt).getTime();
  const work = w.exercises.map((e) => e.sets.filter(isWorkSet));
  return {
    durationMin: Math.max(0, Math.round((end - new Date(w.startedAt).getTime()) / 60000)),
    exercises: work.filter((s) => s.length > 0).length,
    sets: work.reduce((n, s) => n + s.length, 0),
    reps: work.reduce((n, s) => n + s.reduce((r, set) => r + (set.reps ?? 0), 0), 0),
    volumeKg: Math.round(w.exercises.reduce((v, e) => v + exerciseVolume(e), 0)),
    records: w.records?.length ?? 0,
    cardioMin: work.reduce((n, s) => n + s.reduce((m, set) => m + (set.durationMin ?? 0), 0), 0),
  };
}

export type PlanStatus = 'as_planned' | 'more' | 'less' | 'skipped' | 'replaced' | 'extra' | 'unplanned';

export interface PlanVsActual {
  status: PlanStatus;
  /** "3 × 8–10 @ 80 kg" / "1 × 30 min" – undefined without a plan snapshot. */
  planned?: string;
  /** "8 @ 80 · 8 @ 80 · 7 @ 80" */
  actual: string;
  /** "Kniebeugen" – the planned exercise when replaced. */
  replacedFrom?: string;
}

const range = (min: number, max: number) => (min === max ? `${min}` : `${min}–${max}`);

export function plannedText(p: NonNullable<WorkoutExercise['planned']>): string {
  if (p.durationMin) return `${p.sets} × ${p.durationMin} min`;
  return `${p.sets} × ${range(p.repMin, p.repMax)}${p.weightKg ? ` @ ${formatKg(p.weightKg)} kg` : ''}`;
}

/** What was planned for an exercise and what really happened – deviations are information, not errors. */
export function planVsActual(ex: WorkoutExercise): PlanVsActual {
  const done = ex.sets.filter(isWorkSet);
  const rir = (s: (typeof done)[number]) => (s.rpe !== undefined ? ` (${effortText(s.rpe)})` : '');
  const actual = done.map((s) => (s.durationMin ? formatSet(s) : s.weightKg ? `${s.reps ?? 0} @ ${formatKg(s.weightKg)}${rir(s)}` : `${s.reps ?? 0} Wdh.${rir(s)}`)).join(' · ');
  const planned = ex.planned ? plannedText(ex.planned) : undefined;
  const base = { actual, ...(planned ? { planned } : {}) };
  if (ex.extra) return { ...base, status: 'extra' };
  if (!ex.planned) return { ...base, status: 'unplanned' };
  if (ex.skipped || done.length === 0) return { ...base, status: 'skipped' };
  if (ex.replacedFrom) return { ...base, status: 'replaced', replacedFrom: getExercise(ex.replacedFrom)?.name ?? 'Übung' };
  if (done.length > ex.planned.sets) return { ...base, status: 'more' };
  const short = done.length < ex.planned.sets || (!ex.planned.durationMin && done.some((s) => (s.reps ?? 0) < ex.planned!.repMin));
  return { ...base, status: short ? 'less' : 'as_planned' };
}

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  as_planned: 'Wie geplant',
  more: 'Mehr als geplant',
  less: 'Weniger als geplant',
  skipped: 'Ausgelassen',
  replaced: 'Ersetzt',
  extra: 'Zusätzlich',
  unplanned: '',
};

/** "4 von 6 Übungen gemacht · 1 ersetzt · 2 ausgelassen" / "6 von 6 Übungen wie geplant" – one honest line that leads with what was done. */
export function planSummary(w: Workout): string | undefined {
  const rows = w.exercises.map(planVsActual).filter((r) => r.status !== 'unplanned');
  const planned = rows.filter((r) => r.status !== 'extra').length;
  if (!planned) return undefined;
  const count = (s: PlanStatus) => rows.filter((r) => r.status === s).length;
  const ok = count('as_planned') + count('more');
  // Lead with what was done; "wie geplant" only when everything done matched the plan.
  const done = ok + count('less') + count('replaced');
  const parts = [ok === done ? `${ok} von ${planned} Übungen wie geplant` : `${done} von ${planned} Übungen gemacht`];
  if (count('less')) parts.push(`${count('less')} mit weniger Sätzen/Wdh.`);
  if (count('replaced')) parts.push(`${count('replaced')} ersetzt`);
  if (count('skipped')) parts.push(`${count('skipped')} ausgelassen`);
  if (count('extra')) parts.push(`${count('extra')} zusätzlich`);
  return parts.join(' · ');
}

export interface ExerciseSession {
  date: ISODate;
  workoutId: string;
  best: { weightKg: number | null; reps: number };
  /** Epley estimate from the best set; 0 for bodyweight without load. */
  e1rm: number;
  volumeKg: number;
  reps: number;
}

/** Every completed session of an exercise, oldest first – the basis of the exercise chart. */
export function exerciseHistory(workouts: Workout[], exerciseId: string): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  for (const w of [...workouts].filter((x) => x.status === 'completed').sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const entries = w.exercises.filter((e) => e.exerciseId === exerciseId);
    const sets = entries.flatMap((e) => e.sets.filter(isWorkSet)).filter((s) => (s.reps ?? 0) > 0);
    if (!sets.length) continue;
    const score = (s: (typeof sets)[number]) => ((s.weightKg ?? 0) > 0 ? estimateOneRepMax(s.weightKg!, s.reps!) : s.reps!);
    const best = sets.reduce((a, b) => (score(b) > score(a) ? b : a));
    out.push({
      date: w.date,
      workoutId: w.id,
      best: { weightKg: best.weightKg, reps: best.reps! },
      e1rm: (best.weightKg ?? 0) > 0 ? Math.round(estimateOneRepMax(best.weightKg!, best.reps!) * 10) / 10 : 0,
      volumeKg: Math.round(entries.reduce((v, e) => v + exerciseVolume(e), 0)),
      reps: sets.reduce((n, s) => n + (s.reps ?? 0), 0),
    });
  }
  return out;
}

/** Best set ever ("Bestleistung") – by estimated 1RM, bodyweight by reps. */
export function bestSet(workouts: Workout[], exerciseId: string): ExerciseSession['best'] | undefined {
  const h = exerciseHistory(workouts, exerciseId);
  if (!h.length) return undefined;
  const score = (s: ExerciseSession) => s.e1rm || s.best.reps;
  return h.reduce((a, b) => (score(b) > score(a) ? b : a)).best;
}

/** Completed workouts grouped by week (newest first) – the history list. */
export function historyByWeek(workouts: Workout[], weekStartOf: (d: ISODate) => ISODate): Array<{ week: ISODate; workouts: Workout[] }> {
  const groups = new Map<ISODate, Workout[]>();
  for (const w of [...workouts].filter((x) => x.status === 'completed').sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    const k = weekStartOf(w.date);
    groups.set(k, [...(groups.get(k) ?? []), w]);
  }
  return [...groups.entries()].map(([week, list]) => ({ week, workouts: list }));
}
