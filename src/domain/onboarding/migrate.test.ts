import { describe, expect, it } from 'vitest';
import { FOODS } from '../../data/foods';
import { emptyState } from '../../store/persistence';
import { basalMetabolicRate, calorieFloor, calculateTargets, foodAllowed } from '../nutrition';
import type { AppState } from '../types';
import { defaultAnswers, defaultCoreSetup, emptyOnboarding, isSetupComplete, migrateExclusions, migrateOnboarding } from './migrate';

const NOW = new Date('2026-10-01T08:00:00Z');
const AT = NOW.toISOString();

/** A user who finished the old onboarding (schema v2 data). */
const finished = (patch: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  profile: { name: 'A', sex: 'female', age: 30, heightCm: 168, activity: 'moderate', experience: 'intermediate', createdAt: '2026-08-01T09:00:00Z' },
  goal: { type: 'recomp', startWeightKg: 64, targetWeightKg: 62, startedAt: '2026-08-01' },
  nutritionProfile: { diet: 'vegetarian', excluded: ['nuts', 'lactose'], slots: ['breakfast', 'lunch', 'dinner'], dislikedFoods: ['tofu'] },
  training: { programId: 'full-body', weekdays: [0, 2, 4], trainingYears: 2, sessionMinutes: 45, equipmentItems: ['dumbbells'], limitations: { areas: ['knee'], excludedExercises: [] }, musclePriorities: ['shoulders', 'glutes', 'back'] },
  targets: [{ id: 't', validFrom: '2026-08-01', method: 'formula', kcal: 2000, protein: 128, carbs: 220, fat: 60 }],
  weights: [{ id: 'w', date: '2026-08-01', kg: 64 }],
  measurements: [{ id: 'm', date: '2026-08-01', kind: 'body_fat', value: 27, method: 'estimate' }],
  ...patch,
});

describe('onboarding migration (v2 → v3)', () => {
  it('takes over the core data with its source and marks the old onboarding as finished (no new run)', () => {
    const s = migrateOnboarding(finished(), NOW);
    const o = s.onboarding!;
    expect(o.progress).toMatchObject({ finishedAt: '2026-08-01T09:00:00Z', legacy: true, completed: { A: '2026-08-01T09:00:00Z', B: '2026-08-01T09:00:00Z', C: '2026-08-01T09:00:00Z' } });
    expect(o.body.birthYear).toEqual({ value: 1996, source: 'estimated', updatedAt: AT }); // only the age was stored
    expect(o.body.sex).toMatchObject({ value: 'female', source: 'user' });
    expect(o.body.weightKg).toMatchObject({ value: 64, source: 'user' });
    expect(o.body.trainingExperience).toMatchObject({ value: '1to2', source: 'user' });
    expect(o.body.bodyFat).toMatchObject({ value: { method: 'visual', percent: 27, range: [22, 32] }, source: 'user' });
    expect(o.goal.type).toMatchObject({ value: 'recomp' });
    expect(o.food.preferences).toMatchObject({ value: { tofu: 'dislike' } });
    expect(o.training.focusMuscles!.value).toEqual(['shoulders', 'glutes']); // at most two
    expect(o.training.complaints!.value).toEqual({ areas: ['knee'] });
    // The core data is not touched.
    expect(s.profile).toEqual(finished().profile);
    expect(s.nutritionProfile).toEqual(finished().nutritionProfile);
  });

  it('E5: "Nüsse" becomes peanuts AND tree nuts (marked "migrated"), "Laktose" stays the intolerance', () => {
    const o = migrateOnboarding(finished(), NOW).onboarding!;
    expect(o.food.allergens).toEqual({ value: ['peanuts', 'tree_nuts'], source: 'migrated', updatedAt: AT });
    expect(o.food.intolerances).toEqual({ value: ['lactose'], source: 'user', updatedAt: AT });
    expect(migrateExclusions(['gluten', 'fish'], AT).allergens).toMatchObject({ value: ['gluten', 'fish'], source: 'user' });
    expect(migrateExclusions([], AT)).toEqual({});
  });

  it('E5: after the migration no food is allowed that was excluded before (whole catalog)', () => {
    for (const excluded of [['nuts'], ['lactose'], ['gluten', 'fish'], ['nuts', 'lactose', 'gluten', 'fish']] as const) {
      const before = finished({ nutritionProfile: { diet: 'omnivore', excluded: [...excluded], slots: ['lunch'] } });
      const after = migrateOnboarding(before, NOW);
      for (const food of FOODS) if (!foodAllowed(food, before.nutritionProfile)) expect(foodAllowed(food, after.nutritionProfile), `${food.id} ${excluded}`).toBe(false);
    }
  });

  it('is idempotent – a second run returns the very same state', () => {
    const once = migrateOnboarding(finished(), NOW);
    expect(migrateOnboarding(once, NOW)).toBe(once);
    expect(migrateOnboarding(once, new Date('2027-05-01T08:00:00Z'))).toBe(once); // a later load changes nothing either
  });

  it('never overwrites existing answers', () => {
    const own = emptyOnboarding();
    own.body.sex = { value: 'unspecified', source: 'user', updatedAt: '2026-09-01T00:00:00Z' };
    const s = migrateOnboarding(finished({ onboarding: own }), NOW);
    expect(s.onboarding!.body.sex).toEqual(own.body.sex);
    expect(s.onboarding!.body.heightCm).toMatchObject({ value: 168 }); // missing ones are filled
  });

  it('works next to the still active old onboarding: data it writes later is taken over on the next load', () => {
    const fresh = migrateOnboarding(emptyState(), NOW);
    expect(fresh.onboarding!.progress).toEqual({ completed: {}, skipped: [] });
    expect(isSetupComplete(fresh)).toBe(false);
    // The old onboarding completes (writes the core data, leaves `onboarding` alone) → next load.
    const completed = migrateOnboarding({ ...finished(), onboarding: fresh.onboarding }, NOW);
    expect(completed.onboarding!.progress.legacy).toBe(true);
    expect(completed.onboarding!.food.diet).toMatchObject({ value: 'vegetarian' });
  });

  it('an incomplete setup is not "finished" – it resumes; a paused new onboarding stays paused', () => {
    const partial = migrateOnboarding(finished({ training: null }), NOW);
    expect(partial.onboarding!.progress.finishedAt).toBeUndefined();
    expect(partial.onboarding!.body.heightCm).toMatchObject({ value: 168 });
    const paused = emptyOnboarding();
    paused.progress = { ...paused.progress, step: 'diet', active: false };
    const s = migrateOnboarding(finished({ onboarding: paused }), NOW);
    expect(s.onboarding!.progress.finishedAt).toBeUndefined();
    expect(s.onboarding!.progress.step).toBe('diet');
  });

  it('a damaged onboarding record is rebuilt from the core data – the core data survives', () => {
    for (const broken of ['nonsense', { version: 99 }, { version: 1, progress: null }, { version: 1, progress: { completed: {}, skipped: [] } }] as unknown[]) {
      const s = migrateOnboarding(finished({ onboarding: broken as AppState['onboarding'] }), NOW);
      expect(s.onboarding!.version).toBe(1);
      expect(s.onboarding!.body.sex).toMatchObject({ value: 'female' });
      expect(s.profile).toEqual(finished().profile);
    }
  });
});

describe('defaults for an app used without finishing the onboarding', () => {
  it('uses the answers given, neutral defaults for the rest – recorded as "default"', () => {
    const p = emptyOnboarding();
    p.body.weightKg = { value: 82, source: 'user', updatedAt: AT };
    const setup = defaultCoreSetup(p, '2026-10-01', AT);
    expect(setup.weightKg).toBe(82);
    expect(setup.profile).toMatchObject({ sex: 'unspecified', age: 35, heightCm: 170, activity: 'light' });
    expect(setup.goal.type).toBe('maintain');
    expect(setup.training.weekdays).toEqual([0, 2, 4]);
    const { kcal, protein, carbs, fat } = calculateTargets(setup.profile, 'maintain', 82, 3);
    expect(setup.target).toEqual({ kcal, protein, carbs, fat });
    const answers = defaultAnswers(p, setup, AT);
    expect(answers.body.weightKg).toEqual(p.body.weightKg); // the user's value stays
    expect(answers.body.heightCm).toEqual({ value: 170, source: 'default', updatedAt: AT });
    expect(answers.body.sex).toMatchObject({ value: 'unspecified', source: 'default' });
  });

  it('a body fat answer reaches the app: stored as a measurement, the target uses the matching formula', () => {
    const p = emptyOnboarding();
    p.body.weightKg = { value: 80, source: 'user', updatedAt: AT };
    p.body.bodyFat = { value: { method: 'navy', percent: 18, range: [15, 22] }, source: 'estimated', updatedAt: AT };
    const setup = defaultCoreSetup(p, '2026-10-01', AT);
    expect(setup.bodyFat).toEqual({ value: 18, method: 'estimate' });
    const { kcal } = calculateTargets(setup.profile, 'maintain', 80, 3, { bodyFat: { method: 'navy', percent: 18, range: [15, 22] } });
    expect(setup.target.kcal).toBe(kcal);
    expect(setup.target.kcal).not.toBe(defaultCoreSetup({ ...p, body: { weightKg: p.body.weightKg } }, '2026-10-01', AT).target.kcal);
  });

  it('pregnancy / breastfeeding: only "Halten & Gesundheit", whatever goal was chosen (E4)', () => {
    const p = emptyOnboarding();
    p.goal.type = { value: 'fat_loss', source: 'user', updatedAt: AT };
    p.health.pregnancy = { value: 'breastfeeding', source: 'user', updatedAt: AT };
    expect(defaultCoreSetup(p, '2026-10-01', AT).goal.type).toBe('maintain');
  });
});

describe('energy with "keine Angabe" (E2)', () => {
  it('Mifflin-St Jeor uses the mean constant −78 – between the male and the female result', () => {
    const base = { age: 30, heightCm: 180 };
    expect(basalMetabolicRate({ ...base, sex: 'male' }, 80)).toBe(1780); // reference value of Prompt 2
    expect(basalMetabolicRate({ ...base, sex: 'female' }, 80)).toBe(1614);
    expect(basalMetabolicRate({ ...base, sex: 'unspecified' }, 80)).toBe(1697);
  });

  it('the calorie floor without an answer is the more careful 1500 kcal', () => {
    expect(calorieFloor({ sex: 'unspecified', age: 70, heightCm: 150 }, 45)).toBe(1500);
    expect(calorieFloor({ sex: 'female', age: 70, heightCm: 150 }, 45)).toBe(1200);
  });
});
