// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { emptyState, loadState } from './persistence';

const KEY = 'lifefit:v1';
const BACKUP_KEY = 'lifefit:corrupt-backup';

const v2 = {
  ...emptyState(),
  schemaVersion: 2,
  profile: { name: 'A', sex: 'male', age: 40, heightCm: 182, activity: 'light', experience: 'beginner', createdAt: '2026-08-01T09:00:00Z' },
  goal: { type: 'fat_loss', startWeightKg: 90, startedAt: '2026-08-01' },
  nutritionProfile: { diet: 'omnivore', excluded: ['nuts'], slots: ['lunch', 'dinner'] },
  training: { programId: 'full-body', weekdays: [1, 3] },
  targets: [{ id: 't', validFrom: '2026-08-01', method: 'formula', kcal: 2300, protein: 180, carbs: 220, fat: 75 }],
};

describe('persistence: schema v3 (onboarding record)', () => {
  afterEach(() => localStorage.clear());

  it('loads v2 data as v3: everything kept, the onboarding record derived, nothing written while loading', () => {
    localStorage.setItem(KEY, JSON.stringify(v2));
    const { state, notice } = loadState();
    expect(notice).toBeUndefined();
    expect(state.schemaVersion).toBe(3);
    expect(state.profile).toEqual(v2.profile);
    expect(state.nutritionProfile).toEqual(v2.nutritionProfile);
    expect(state.targets).toEqual(v2.targets); // target versions are snapshots – byte-identical
    expect(state.onboarding!.progress).toMatchObject({ legacy: true, finishedAt: '2026-08-01T09:00:00Z' });
    expect(state.onboarding!.food.allergens).toMatchObject({ value: ['peanuts', 'tree_nuts'], source: 'migrated' });
    expect(JSON.parse(localStorage.getItem(KEY)!).schemaVersion).toBe(2); // loading never writes
  });

  it('loads saved v3 data unchanged (idempotent)', () => {
    localStorage.setItem(KEY, JSON.stringify(v2));
    const first = loadState().state;
    localStorage.setItem(KEY, JSON.stringify(first));
    const second = loadState().state;
    expect(second.onboarding).toEqual(first.onboarding);
  });

  it('damaged JSON or an unknown version: a backup is kept, the app starts empty', () => {
    localStorage.setItem(KEY, '{ broken');
    expect(loadState()).toMatchObject({ notice: 'recovered' });
    expect(localStorage.getItem(BACKUP_KEY)).toBe('{ broken');

    localStorage.setItem(KEY, JSON.stringify({ ...v2, schemaVersion: 99 }));
    expect(loadState()).toMatchObject({ notice: 'recovered' });
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY)!).schemaVersion).toBe(99);
  });

  it('a damaged onboarding record never costs the core data', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...v2, schemaVersion: 3, onboarding: { version: 1, progress: 'x' } }));
    const { state, notice } = loadState();
    expect(notice).toBeUndefined();
    expect(state.profile).toEqual(v2.profile);
    expect(state.onboarding!.body.heightCm).toMatchObject({ value: 182 });
  });
});
