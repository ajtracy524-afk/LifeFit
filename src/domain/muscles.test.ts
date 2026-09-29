import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../data/exercises';
import { EXERCISE_MUSCLES, MUSCLE_GROUP_OF, type Muscle } from '../data/muscles';
import { exerciseRegions } from './engine/trainingRules';
import { exerciseMuscles, muscleVolume } from './muscles';
import type { Workout } from './types';

describe('muscle model', () => {
  it('covers every strength exercise and no cardio / mobility', () => {
    for (const ex of EXERCISES) expect(!!EXERCISE_MUSCLES[ex.id], ex.id).toBe(ex.type === 'strength');
    for (const id of Object.keys(EXERCISE_MUSCLES)) expect(EXERCISES.some((e) => e.id === id), id).toBe(true);
  });

  it('agrees with the library groups: primary group fully loaded, strong helpers listed as secondary', () => {
    for (const ex of EXERCISES.filter((e) => e.type === 'strength')) {
      const w = exerciseMuscles(ex.id);
      const groupMax = (g: string) => Math.max(0, ...Object.entries(w).filter(([m]) => MUSCLE_GROUP_OF[m as Muscle] === g).map(([, f]) => f ?? 0));
      expect(groupMax(ex.primary), `${ex.id} primary`).toBe(1);
      for (const [m, f] of Object.entries(w)) {
        const g = MUSCLE_GROUP_OF[m as Muscle];
        if ((f ?? 0) >= 0.5 && g !== ex.primary) expect(ex.secondary, `${ex.id} ${m}`).toContain(g);
        expect([0.25, 0.5, 0.75, 1]).toContain(f);
      }
    }
  });

  it('distinguishes the parts of a muscle group', () => {
    expect(exerciseMuscles('bench-press')).toMatchObject({ chest: 1, triceps: 0.5, front_delt: 0.5 });
    const incline = exerciseMuscles('incline-db-press');
    expect(incline.chest_upper).toBeGreaterThan(exerciseMuscles('bench-press').chest_upper!);
    expect(incline.front_delt).toBeGreaterThan(exerciseMuscles('bench-press').front_delt!);
    expect(exerciseMuscles('lateral-raise')).toEqual({ side_delt: 1 });
    expect(exerciseMuscles('zone2-bike')).toEqual({});
  });

  it('derives the engine regions from the same weights', () => {
    expect(exerciseRegions('incline-db-press')).toEqual({ chest: 1, shoulders: 0.75, arms: 0.5 });
    expect(exerciseRegions('calf-raise')).toEqual({ legs: 0.5 });
    expect(exerciseRegions('deadlift')).toMatchObject({ legs: 1, back: 0.5 });
  });

  it('counts effective sets per muscle only from completed work sets in the window', () => {
    const set = (warmup = false) => ({ weightKg: 60, reps: 8, done: true, ...(warmup ? { type: 'warmup' as const } : {}) });
    const w = (date: string, status: Workout['status'] = 'completed') =>
      ({ id: date, date, status, startedAt: `${date}T10:00:00`, exercises: [{ exerciseId: 'bench-press', sets: [set(true), set(), set(), set()] }] }) as unknown as Workout;
    const v = muscleVolume([w('2026-09-21'), w('2026-09-23', 'in_progress'), w('2026-09-10')], '2026-09-21', '2026-09-27');
    expect(v.chest).toBe(3);
    expect(v.triceps).toBe(1.5);
    expect(v.side_delt).toBe(0);
  });
});
