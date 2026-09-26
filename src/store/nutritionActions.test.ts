// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, PlannedMeal, Product } from '../domain/types';

/**
 * Store-level tests: the actions are the only write path. One confirmation =
 * one entry, learning only from real consumption, undo and reload keep data.
 */

const T = new Date();
const today = `${T.getFullYear()}-${String(T.getMonth() + 1).padStart(2, '0')}-${String(T.getDate()).padStart(2, '0')}`;

const PRODUCT: Product = {
  barcode: '4000000000009',
  name: 'Skyr Vanille',
  brand: 'Marke',
  per100: { kcal: 80, protein: 10, carbs: 8, fat: 0.2 },
  micros100: { sugar: 7 },
  unit: 'g',
  packageSize: 450,
  source: 'openfoodfacts',
  fetchedAt: T.toISOString(),
};

const meal = (id: string, slot: PlannedMeal['slot'], recipeId: string): PlannedMeal => ({ id, date: today, slot, recipeId, servings: 1, status: 'planned', source: 'suggest' });

async function load(patch: Partial<AppState> = {}) {
  vi.resetModules();
  const persistence = await import('./persistence');
  const store = await import('./store');
  const actions = await import('./actions');
  const undo = await import('../lib/undo');
  store.commit({
    ...persistence.emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: T.toISOString() },
    goal: { type: 'maintain', startWeightKg: 80, startedAt: today },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'snack', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: today, method: 'formula', kcal: 2680, protein: 180, carbs: 300, fat: 80 }],
    training: { programId: 'full-body', weekdays: [] },
    ...patch,
  });
  return { store, actions, undo, persistence };
}

async function reload() {
  vi.resetModules();
  return (await import('./store')).getState();
}

beforeEach(() => {
  localStorage.clear();
});

describe('logging scanned and manual food', () => {
  it('one confirmation = one entry, even if the button is tapped twice', async () => {
    const { store, actions } = await load();
    expect(actions.logProduct(today, 'breakfast', PRODUCT, 250, { id: 'confirm-1' })).toBe(true);
    expect(actions.logProduct(today, 'breakfast', PRODUCT, 250, { id: 'confirm-1' })).toBe(false);
    const entries = store.getState().logEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ method: 'barcode', amount: 250, macros: { kcal: 200, protein: 25, carbs: 20, fat: 0.5 }, micros: { sugar: 17.5 } });
    // The product is remembered locally for next time (offline, no request).
    expect(store.getState().products[PRODUCT.barcode]?.name).toBe('Skyr Vanille');
  });

  it('a scanned product linked to a catalog food is a weak taste signal; unlinked it is none', async () => {
    const { store, actions } = await load();
    actions.logProduct(today, 'breakfast', PRODUCT, 150);
    expect(store.getState().learning.preferences).toEqual({});
    actions.logProduct(today, 'breakfast', PRODUCT, 150, { foodId: 'skyr' });
    expect(store.getState().learning.preferences['food:skyr']).toMatchObject({ pos: 1, neg: 0 });
    // The link is remembered with the product.
    expect(store.getState().products[PRODUCT.barcode]?.foodId).toBe('skyr');
  });

  it('manual entries learn only with a chosen catalog food; deleting takes it back', async () => {
    const { store, actions } = await load();
    const { manualEntry, EMPTY_MANUAL } = await import('../domain/foodEntry');
    const plain = manualEntry({ ...EMPTY_MANUAL, name: 'Burger', kcal: '800' });
    const linked = manualEntry({ ...EMPTY_MANUAL, name: 'Skyr', kcal: '120', amount: '200', foodId: 'skyr' });
    if (!plain.ok || !linked.ok) throw new Error('invalid');
    actions.logEntry(today, 'lunch', plain.entry);
    expect(store.getState().learning.preferences).toEqual({});
    actions.logEntry(today, 'snack', linked.entry, { id: 'm1' });
    expect(store.getState().learning.preferences['food:skyr']?.pos).toBe(1);
    actions.removeLogEntry('m1');
    expect(store.getState().learning.preferences['food:skyr']?.pos).toBe(0);
  });

  it('undo removes the entry again', async () => {
    const { store, actions, undo } = await load();
    const before = store.snapshot();
    undo.withUndo('x', () => actions.logProduct(today, 'breakfast', PRODUCT, 100));
    const after = store.snapshot();
    expect(after.logEntries).toHaveLength(1);
    undo.undoTo(before, after);
    expect(store.getState().logEntries).toHaveLength(0);
  });

  it('a duplicate shows no "erfasst" toast (withUndo returns false)', async () => {
    const { actions, undo } = await load();
    actions.logProduct(today, 'breakfast', PRODUCT, 100, { id: 'same' });
    expect(undo.withUndo('x', () => actions.logProduct(today, 'breakfast', PRODUCT, 100, { id: 'same' }))).toBe(false);
  });
});

describe('planned meal → eaten, "Anders gegessen", suggestions', () => {
  it('"Gegessen" logs the planned meal once and learns it', async () => {
    const { store, actions } = await load({ plannedMeals: [meal('b', 'breakfast', 'skyr-bowl')] });
    actions.markEaten('b');
    actions.markEaten('b');
    const s = store.getState();
    expect(s.logEntries.filter((e) => e.plannedMealId === 'b')).toHaveLength(1);
    expect(s.learning.preferences['recipe:skyr-bowl']?.pos).toBe(1);
  });

  it('"Anders gegessen" + barcode: plan kept as skipped, the real food is logged, both signals are small', async () => {
    const { store, actions } = await load({ plannedMeals: [meal('b', 'breakfast', 'skyr-bowl')] });
    actions.skipMeal('b');
    actions.logProduct(today, 'breakfast', PRODUCT, 200, { foodId: 'skyr' });
    const s = store.getState();
    expect(s.plannedMeals[0]!.status).toBe('skipped');
    expect(s.logEntries).toHaveLength(1);
    expect(s.logEntries[0]!.plannedMealId).toBeUndefined();
    expect(s.learning.preferences['recipe:skyr-bowl']).toMatchObject({ neg: 1 });
    expect(s.learning.preferences['food:skyr']).toMatchObject({ pos: 1 });
  });

  it('eating a suggestion instead of the planned meal swaps it and marks it eaten', async () => {
    const { store, actions } = await load({ plannedMeals: [meal('l', 'lunch', 'chili')] });
    expect(actions.eatSuggestion(today, 'lunch', 'bolognese', 1, 'l')).toBe(true);
    const s = store.getState();
    expect(s.plannedMeals).toHaveLength(1);
    expect(s.plannedMeals[0]).toMatchObject({ recipeId: 'bolognese', status: 'eaten' });
    expect(s.logEntries.filter((e) => e.plannedMealId === 'l')).toHaveLength(1);
  });

  it('a suggestion for an empty slot is added as eaten', async () => {
    const { store, actions } = await load();
    actions.eatSuggestion(today, 'snack', 'quark-berries', 1);
    expect(store.getState().plannedMeals[0]).toMatchObject({ slot: 'snack', recipeId: 'quark-berries', status: 'eaten', source: 'user' });
  });
});

describe('water', () => {
  it('+250 and +500 on one day, goal stored in the profile, all survives a reload', async () => {
    const { store, actions } = await load();
    actions.addWaterMl(today, 250);
    actions.addWaterMl(today, 500);
    actions.setWaterGoal(2500);
    expect(store.getState().water[today]).toBe(750);
    const reloaded = await reload();
    expect(reloaded.water[today]).toBe(750);
    expect(reloaded.nutritionProfile?.waterGoalMl).toBe(2500);
  });

  it('undo takes back the last glass', async () => {
    const { store, actions, undo } = await load();
    actions.addWaterMl(today, 500);
    const before = store.snapshot();
    undo.withUndo('x', () => actions.addWaterMl(today, 250));
    undo.undoTo(before, store.snapshot());
    expect(store.getState().water[today]).toBe(500);
  });
});

describe('persistence', () => {
  it('scanned entries and products survive a reload', async () => {
    const { actions } = await load();
    actions.logProduct(today, 'breakfast', PRODUCT, 250, { foodId: 'skyr' });
    const s = await reload();
    expect(s.logEntries[0]).toMatchObject({ method: 'barcode', barcode: PRODUCT.barcode, amount: 250 });
    expect(s.products[PRODUCT.barcode]).toMatchObject({ name: 'Skyr Vanille', foodId: 'skyr' });
  });

  it('older saved data without products/water loads with empty defaults', async () => {
    const { persistence } = await load();
    const old = { ...persistence.emptyState() } as Partial<AppState>;
    delete old.products;
    delete old.water;
    localStorage.setItem('lifefit:v1', JSON.stringify(old));
    const s = await reload();
    expect(s.products).toEqual({});
    expect(s.water).toEqual({});
  });
});
