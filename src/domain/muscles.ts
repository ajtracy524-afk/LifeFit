import { EXERCISE_MUSCLES, MUSCLE_GROUP_OF, type Muscle, type MuscleWeights } from '../data/muscles';
import { isWorkSet } from './training';
import type { ISODate, Workout } from './types';

export type { Muscle, MuscleWeights } from '../data/muscles';
export { MUSCLE_NAME } from '../data/muscles';

export const MUSCLES = Object.keys(MUSCLE_GROUP_OF) as Muscle[];

/** How much an exercise loads each muscle (see data/muscles.ts). Cardio, mobility and unknown ids load none. */
export function exerciseMuscles(exerciseId: string): MuscleWeights {
  return EXERCISE_MUSCLES[exerciseId] ?? {};
}

export type MuscleSets = Record<Muscle, number>;

const emptyMuscles = (): MuscleSets => Object.fromEntries(MUSCLES.map((m) => [m, 0])) as MuscleSets;

/**
 * Effective work sets per muscle of completed workouts in [from, to] – sets ×
 * load weight. Only what was really done counts. The data basis for later
 * balance / volume views; the engine's coarse regions are derived from the
 * same weights (engine/trainingRules.ts).
 */
export function muscleVolume(workouts: Workout[], from: ISODate, to: ISODate): MuscleSets {
  const out = emptyMuscles();
  for (const w of workouts) {
    if (w.status !== 'completed' || w.date < from || w.date > to) continue;
    for (const e of w.exercises) {
      const sets = e.sets.filter(isWorkSet).length;
      if (!sets) continue;
      for (const [m, f] of Object.entries(exerciseMuscles(e.exerciseId))) out[m as Muscle] += sets * (f ?? 0);
    }
  }
  return out;
}
