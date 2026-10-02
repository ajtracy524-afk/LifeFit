// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../domain/types';

/** Prompt 8 – "Plan übernehmen": the generated plan becomes the active program of the existing rotation. */

const T = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = iso(T);

async function load(patch: Partial<AppState> = {}) {
  vi.resetModules();
  const persistence = await import('./persistence');
  const store = await import('./store');
  const onboarding = await import('./onboardingActions');
  const gen = await import('../domain/training/recommendPlan');
  const training = await import('../domain/training');
  const dates = await import('../domain/dates');
  const nutrition = await import('../domain/nutrition');
  store.commit({
    ...persistence.emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'intermediate', createdAt: T.toISOString() },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: today },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: today, method: 'formula', kcal: 2800, protein: 160, carbs: 330, fat: 80 }],
    training: { programId: 'full-body', weekdays: [0, 2, 4], workingWeights: { 'bench-press': { kg: 100, reps: 5 } } },
    weights: [{ id: 'w', date: today, kg: 80 }],
    ...patch,
  });
  return { store, onboarding, gen, training, dates, nutrition };
}

beforeEach(() => localStorage.clear());

describe('adopting the plan', () => {
  it('becomes the active program of the rotation – the same session on the same weekday every week', async () => {
    const { store, onboarding, gen, training, dates } = await load();
    const plan = gen.recommendPlan({ weekdays: [0, 1, 3, 4], level: 'intermediate', sessionMinutes: 60 });
    const programId = onboarding.adoptPlan(plan)!;
    const s = store.getState();
    expect(programId).toMatch(/^program:plan-/);
    expect(s.customPrograms[programId]!.routineIds).toHaveLength(4);
    expect(s.training).toMatchObject({ programId, weekdays: [0, 1, 3, 4] });
    // Changed on the day the plan started: the start version is updated (existing rule), with the new program.
    expect(s.planVersions!.at(-1)).toMatchObject({ programId });
    expect(s.onboarding!.training.plan).toMatchObject({ value: { programId, weekdays: [0, 1, 3, 4] }, source: 'user' });

    const names = (week: string) => training.resolveWorkouts(s.training, {}, [], week).map((w) => [dates.weekdayIndex(w.date), w.template.name]);
    const thisWeek = dates.weekStart(today);
    const expected = [
      [0, 'Oberkörper'],
      [1, 'Unterkörper'],
      [3, 'Oberkörper'],
      [4, 'Unterkörper'],
    ];
    expect(names(thisWeek)).toEqual(expected);
    expect(names(dates.addDays(thisWeek, 7))).toEqual(expected);
    expect(names(dates.addDays(thisWeek, 21))).toEqual(expected);
    // The exercises of the plan (not of the old program) are what the session starts with.
    const upper = training.resolveWorkouts(s.training, {}, [], thisWeek)[0]!.template;
    expect(upper.exercises.map((e) => e.exerciseId)).toEqual(plan.sessions[0]!.template.exercises.map((e) => e.exerciseId));
  });

  it('takes over the start weights of Prompt 7 and feeds the training surcharge', async () => {
    const { store, onboarding, gen, training, nutrition } = await load();
    const plan = gen.recommendPlan({ weekdays: [0, 1, 3, 4], level: 'intermediate', sessionMinutes: 60 });
    onboarding.adoptPlan(plan);
    const s = store.getState();
    const upper = s.routines[s.customPrograms[s.training!.programId]!.routineIds[0]!]!;
    const workout = training.createWorkout(upper, [], today, s.training!.workingWeights);
    const bench = workout.exercises.find((e) => e.exerciseId === 'bench-press');
    // 100 kg × 5 → start weight for the top of the range with 2 reps in reserve (Epley).
    const { startWeight } = await import('../domain/onboarding/training');
    expect(bench?.planned?.weightKg).toBe(startWeight({ kg: 100, reps: 5 }, bench!.repMax, 2.5));
    expect(bench?.planned?.weightKg).toBeGreaterThan(75);
    // 4 instead of 3 training days → a higher surcharge in the next calculation (a new target only on confirmation, E10).
    const p = s.profile!;
    expect(nutrition.calculateTargets(p, 'muscle_gain', 80, s.training!.weekdays.length).tdee).toBeGreaterThan(nutrition.calculateTargets(p, 'muscle_gain', 80, 3).tdee);
    expect(s.targets).toHaveLength(1);
  });

  it('cardio of the plan: Zone 2 days are stored for Heute; a beginner with 5 days gets cardio / mobility days in the rotation', async () => {
    const { store, onboarding, gen } = await load({ training: { programId: 'full-body', weekdays: [0, 2, 4], cardio: { kind: 'mix', types: ['cycling'] } } });
    const plan = gen.recommendPlan({ weekdays: [0, 1, 2, 3, 4], level: 'beginner', sessionMinutes: 45, cardio: { kind: 'mix', types: ['cycling'] } });
    onboarding.adoptPlan(plan);
    const s = store.getState();
    expect(s.training!.weekdays).toEqual([0, 1, 2, 3, 4]); // 3 strength + 2 mobility days
    const routines = s.customPrograms[s.training!.programId]!.routineIds.map((id) => s.routines[id]!.name);
    expect(routines.filter((n) => n === 'Mobilität')).toHaveLength(2);
    expect(s.training!.cardioDays).toEqual([
      { weekday: 5, kind: 'zone2' },
      { weekday: 6, kind: 'zone2' },
    ]);
  });
});
