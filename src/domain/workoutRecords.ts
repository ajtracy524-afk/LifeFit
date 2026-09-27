import { getExercise } from '../data/exercises';
import { fmt } from '../lib/format';
import { estimateOneRepMax, exerciseVolume, formatKg, isWorkSet } from './training';
import type { PersonalRecord, RecordKind, Workout, WorkoutExercise, WorkoutSet } from './types';

/**
 * Personal records – one logic for the live chip in the session and the
 * summary after finishing. Only real improvements against EARLIER completed
 * workouts count; the first time an exercise is done is never a record (there
 * is nothing to beat). One headline record per exercise, in this order:
 *
 *   max_weight  heavier than ever (any reps)          "+5 kg"
 *   rep         more reps at the same weight           "10 statt 8"
 *   est_1rm     better estimated 1RM (Epley)           e.g. 75 × 12 after 80 × 8
 *   max_reps    bodyweight: more reps than ever
 *   volume      most kg × reps of this exercise in one session
 */

const EPS = 0.01;

export interface ExerciseBests {
  maxWeight: number;
  maxE1rm: number;
  maxReps: number;
  /** Every work set – for "more reps at this weight". */
  sets: Array<{ weightKg: number; reps: number }>;
  bestVolume: number;
  sessions: number;
}

/** Bests of an exercise over completed workouts started before `before` (and not `excludeId`). */
export function exerciseBests(history: Workout[], exerciseId: string, opts: { before?: string; excludeId?: string } = {}): ExerciseBests | undefined {
  const bests: ExerciseBests = { maxWeight: 0, maxE1rm: 0, maxReps: 0, sets: [], bestVolume: 0, sessions: 0 };
  for (const w of history) {
    if (w.status !== 'completed' || w.id === opts.excludeId || (opts.before && w.startedAt >= opts.before)) continue;
    const entries = w.exercises.filter((e) => e.exerciseId === exerciseId);
    const sets = entries.flatMap((e) => e.sets.filter(isWorkSet)).filter((s) => (s.reps ?? 0) > 0);
    if (!sets.length) continue;
    bests.sessions += 1;
    bests.bestVolume = Math.max(bests.bestVolume, entries.reduce((v, e) => v + exerciseVolume(e), 0));
    for (const s of sets) {
      const kg = s.weightKg ?? 0;
      bests.maxWeight = Math.max(bests.maxWeight, kg);
      bests.maxReps = Math.max(bests.maxReps, s.reps!);
      if (kg > 0) bests.maxE1rm = Math.max(bests.maxE1rm, estimateOneRepMax(kg, s.reps!));
      bests.sets.push({ weightKg: kg, reps: s.reps! });
    }
  }
  return bests.sessions ? bests : undefined;
}

/** Most reps ever done at exactly this weight (0 = never) – "10 statt 8" only compares like with like. */
const repsAt = (b: ExerciseBests, weightKg: number) => b.sets.reduce((m, s) => (Math.abs(s.weightKg - weightKg) < EPS ? Math.max(m, s.reps) : m), 0);

/** The headline record a single set sets against `bests` (weight → reps → e1RM; bodyweight: reps). */
export function setRecord(exerciseId: string, set: Pick<WorkoutSet, 'weightKg' | 'reps'>, bests: ExerciseBests): PersonalRecord | undefined {
  const reps = set.reps ?? 0;
  if (reps <= 0) return undefined;
  const kg = set.weightKg ?? 0;
  const bodyweight = getExercise(exerciseId)?.bodyweight;
  const base = { exerciseId, weightKg: set.weightKg, reps };
  if (bodyweight && kg <= 0) return reps > bests.maxReps ? { ...base, kind: 'max_reps', value: reps, previous: bests.maxReps } : undefined;
  if (kg <= 0) return undefined;
  if (bests.maxWeight > 0 && kg > bests.maxWeight + EPS) return { ...base, kind: 'max_weight', value: kg, previous: bests.maxWeight };
  const before = repsAt(bests, kg);
  if (before > 0 && reps > before) return { ...base, kind: 'rep', value: reps, previous: before };
  const e1rm = estimateOneRepMax(kg, reps);
  if (bests.maxE1rm > 0 && e1rm > bests.maxE1rm + EPS) return { ...base, kind: 'est_1rm', value: e1rm, previous: bests.maxE1rm };
  return undefined;
}

/** The session volume of an exercise beats every earlier session of it. */
export function volumeRecord(entry: Pick<WorkoutExercise, 'exerciseId' | 'sets'>, bests: ExerciseBests): PersonalRecord | undefined {
  const volume = exerciseVolume(entry);
  if (bests.bestVolume <= 0 || volume <= bests.bestVolume + EPS) return undefined;
  return { exerciseId: entry.exerciseId, kind: 'volume', value: volume, weightKg: null, reps: 0, previous: bests.bestVolume };
}

const PRIORITY: RecordKind[] = ['max_weight', 'rep', 'est_1rm', 'max_reps', 'volume'];

/** Records beaten in `workout` compared with all earlier completed workouts – one per exercise. */
export function detectRecords(workout: Workout, history: Workout[]): PersonalRecord[] {
  const records: PersonalRecord[] = [];
  const seen = new Set<string>();
  for (const ex of workout.exercises) {
    if (seen.has(ex.exerciseId)) continue;
    seen.add(ex.exerciseId);
    const bests = exerciseBests(history, ex.exerciseId, { before: workout.startedAt, excludeId: workout.id });
    if (!bests) continue;
    const entries = workout.exercises.filter((e) => e.exerciseId === ex.exerciseId);
    const candidates = entries.flatMap((e) => e.sets.filter(isWorkSet)).map((s) => setRecord(ex.exerciseId, s, bests)).filter((r): r is PersonalRecord => !!r);
    const volume = volumeRecord({ exerciseId: ex.exerciseId, sets: entries.flatMap((e) => e.sets) }, bests);
    if (volume) candidates.push(volume);
    const best = candidates.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) || b.value - a.value)[0];
    if (best) records.push(best);
  }
  return records;
}

/** "🏆 Neue Bestleistung" / "Bankdrücken · 85 kg × 6 (+5 kg)" – for the chip and the summary. */
export function recordText(r: PersonalRecord): { icon: string; title: string; detail: string } {
  const name = getExercise(r.exerciseId)?.name ?? 'Übung';
  const set = r.weightKg ? `${formatKg(r.weightKg)} kg × ${r.reps}` : `${r.reps} Wdh.`;
  switch (r.kind) {
    case 'max_weight':
      return { icon: '🏆', title: 'Neue Bestleistung', detail: `${name} · ${set}${r.previous ? ` (+${formatKg(r.value - r.previous)} kg)` : ''}` };
    case 'rep':
      return { icon: '🏆', title: 'Wiederholungs-Rekord', detail: `${name} · ${formatKg(r.weightKg ?? 0)} kg: ${r.reps} statt ${r.previous}` };
    case 'max_reps':
      return { icon: '🏆', title: 'Wiederholungs-Rekord', detail: r.previous ? `${name} · ${r.reps} statt ${r.previous}` : `${name} · ${set}` };
    case 'est_1rm':
      return { icon: '🏆', title: 'Neue Bestleistung', detail: `${name} · ${set} · 1RM ca. ${fmt.int(r.value)} kg` };
    case 'volume':
      return { icon: '🔥', title: 'Volumen-Rekord', detail: `${name} · ${fmt.int(r.value)} kg${r.previous ? ` (+${fmt.int(r.value - r.previous)} kg)` : ''}` };
  }
}
