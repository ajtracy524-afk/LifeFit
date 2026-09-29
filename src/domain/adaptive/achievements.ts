import { getExercise } from '../../data/exercises';
import { addDays, weekStart } from '../dates';
import { appStartDate } from '../progress';
import { formatKg, isWorkSet, resolveWorkouts } from '../training';
import { workoutStats } from '../trainingHistory';
import type { Achievement, AppState, Workout } from '../types';

type StreakState = Pick<AppState, 'training' | 'workoutOverrides' | 'workouts' | 'dayContexts' | 'profile'>;
import { exerciseSessions } from './progression';

/**
 * Adaptive progress worth a moment – only from data, never invented:
 *   🔥 streak    planned sessions done in a row (a missed one ends it; skipping
 *                by decision neither counts nor breaks it) – from 3 on
 *   📈 weight    heavier than the last session of an exercise, inside the rep range
 *                (not repeated when it is already an all-time weight record)
 *   💪 volume    more kg × reps than the last session of the same workout
 *   ⚡ faster    at least 10 % quicker than last time with at least the same sets
 *   🗓️ week      this workout completes every planned session of its week (≥ 2)
 */

export const STREAK_FROM = 3;
const FASTER_SHARE = 0.9;
const STREAK_WEEKS = 12;

export function workoutAchievements(workout: Workout, state: StreakState): Achievement[] {
  const history = state.workouts.filter((w) => w.status === 'completed' && w.id !== workout.id && w.startedAt < workout.startedAt);
  const out: Achievement[] = [];

  if (state.training) {
    const week = resolveWorkouts(state.training, state.workoutOverrides, state.workouts, weekStart(workout.date), state.dayContexts).filter((s) => s.status !== 'skipped');
    const own = week.find((s) => s.completedWorkoutId === workout.id);
    if (own && week.length >= 2 && week.every((s) => s.completedWorkoutId)) out.push({ kind: 'week_complete', icon: '🗓️', title: `Alle ${week.length} Trainings dieser Woche erledigt`, detail: 'Dein Wochenplan ist komplett.' });
  }

  const streak = plannedStreak(workout, state);
  if (streak >= STREAK_FROM) out.push({ kind: 'streak', icon: '🔥', title: `${streak}. Training in Folge`, detail: 'Alle geplanten Einheiten gemacht – ohne Lücke.' });

  const weightRecords = new Set((workout.records ?? []).filter((r) => r.kind === 'max_weight').map((r) => r.exerciseId));
  const heavier: string[] = [];
  for (const ex of workout.exercises) {
    const info = getExercise(ex.exerciseId);
    if (!info || info.type !== 'strength' || info.bodyweight || weightRecords.has(ex.exerciseId)) continue;
    const sets = ex.sets.filter(isWorkSet);
    const top = Math.max(0, ...sets.filter((s) => (s.reps ?? 0) >= ex.repMin).map((s) => s.weightKg ?? 0));
    const last = exerciseSessions(history, ex.exerciseId)[0];
    const before = last ? Math.max(0, ...last.sets.map((s) => s.weightKg ?? 0)) : 0;
    if (top > 0 && before > 0 && top > before) heavier.push(`${info.name} ${formatKg(top)} kg (+${formatKg(top - before)} kg)`);
  }
  if (heavier.length) out.push({ kind: 'weight_up', icon: '📈', title: 'Gewicht gesteigert', detail: heavier.slice(0, 2).join(' · ') });

  const previous = history.filter((w) => w.templateId === workout.templateId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (previous) {
    const now = workoutStats(workout);
    const then = workoutStats(previous);
    if (then.volumeKg > 0 && now.volumeKg > then.volumeKg * 1.01) {
      out.push({ kind: 'volume_up', icon: '💪', title: 'Volumen verbessert', detail: `${formatKg(now.volumeKg - then.volumeKg)} kg mehr als letztes Mal (+${Math.round((now.volumeKg / then.volumeKg - 1) * 100)} %)` });
    }
    if (then.durationMin >= 10 && now.durationMin > 0 && now.durationMin <= then.durationMin * FASTER_SHARE && now.sets >= then.sets) {
      out.push({ kind: 'faster', icon: '⚡', title: 'Schneller fertig', detail: `${now.durationMin} statt ${then.durationMin} min – mit mindestens gleich vielen Sätzen` });
    }
  }
  return out;
}

/** Planned sessions completed in a row up to this workout. */
export function plannedStreak(workout: Workout, state: StreakState): number {
  if (!state.training) return 0;
  const start = appStartDate(state);
  const sessions = Array.from({ length: STREAK_WEEKS }, (_, k) => addDays(weekStart(workout.date), -7 * k)).flatMap((ws) =>
    resolveWorkouts(state.training, state.workoutOverrides, state.workouts, ws, state.dayContexts).filter((s) => s.date <= workout.date && s.originalDate >= start),
  );
  sessions.sort((a, b) => b.date.localeCompare(a.date));
  let n = 0;
  for (const s of sessions) {
    if (s.completedWorkoutId) n++;
    else if (s.status === 'skipped') continue;
    else if (s.date < workout.date) break;
  }
  return n;
}
