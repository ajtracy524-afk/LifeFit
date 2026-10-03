// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyState, loadState, parseBackup, requestPersistentStorage } from './persistence';

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

describe('backup: "Sicherung einspielen"', () => {
  it('reads an export file (wrapper with data) and migrates it like stored data', () => {
    const file = JSON.stringify({ exportedAt: '2026-09-30T18:00:00.000Z', app: 'LifeFit', data: v2 });
    const result = parseBackup(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exportedAt).toBe('2026-09-30T18:00:00.000Z');
    expect(result.state.schemaVersion).toBe(3);
    expect(result.state.targets).toEqual(v2.targets);
    expect(result.state.onboarding!.progress.legacy).toBe(true);
  });

  it('also accepts a raw stored state', () => {
    expect(parseBackup(JSON.stringify(v2)).ok).toBe(true);
  });

  it('refuses what is not a complete LifeFit backup – with a reason, never a half state', () => {
    const reason = (text: string) => {
      const r = parseBackup(text);
      return r.ok ? undefined : r.reason;
    };
    expect(reason('{nope')).toMatch(/kein gültiges JSON/);
    expect(reason(JSON.stringify({ ...v2, schemaVersion: 99 }))).toMatch(/unbekannten Version/);
    expect(reason(JSON.stringify({ ...v2, targets: [] }))).toMatch(/keine vollständigen LifeFit-Daten/);
    expect(reason('null')).toMatch(/keine LifeFit-Sicherung/);
  });
});

describe('persistent storage', () => {
  const withStorage = (storage: unknown) => Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
  afterEach(() => withStorage(undefined));

  it('asks the browser once – not again when already granted, quietly without support', async () => {
    const persist = vi.fn(async () => true);
    withStorage({ persisted: async () => false, persist });
    await requestPersistentStorage();
    expect(persist).toHaveBeenCalledTimes(1);

    const again = vi.fn(async () => true);
    withStorage({ persisted: async () => true, persist: again });
    await requestPersistentStorage();
    expect(again).not.toHaveBeenCalled();

    withStorage(undefined);
    await expect(requestPersistentStorage()).resolves.toBeUndefined();
  });
});
